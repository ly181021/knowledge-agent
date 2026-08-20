/**
 * ParserService —— + 
 * 解析 MinIO 里的文件为带结构标记的文本（mammoth/pdf-parse/marked）
 * 替代Apache Tika
 * DOCX 用 convertToHtml 提取 Word heading 样式 → docxHtmlToMd 转 # 标记，
 * 比Tika 抽纯文本丢样式更好（heading 样式保留为结构信号）。
 */
import { Injectable, Logger } from '@nestjs/common'
import { MinioService } from '@/modules/infra/minio.provider'
import { Document } from '@prisma/client'
import { docxHtmlToMd } from '../strategy/docx-html-to-md'

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name)

  constructor(private minio: MinioService) {}

  /**
   * 从 MinIO 下载文件并解析为文本
   * - MD：原样返回（已带 # 标题）
   * - DOCX：convertToHtml 提取 heading 样式 → 转 Markdown 风格（带 #）
   * - PDF：pdf-parse 抽纯文本（标题靠编号/第N章正则识别）
   * - TXT/其他：纯文本
   */
  async parse(doc: Pick<Document, 'fileUrl' | 'fileType' | 'fileName'>): Promise<string> {
    // 1. 从 MinIO 下载
    const stream = await this.minio.getClient().getObject(this.minio.getBucket(), doc.fileUrl)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)
    this.logger.log(`parsed ${doc.fileName} (${doc.fileType}), size=${buffer.length}`)

    // 2. 按类型解析
    const ext = doc.fileType.toLowerCase()
    switch (ext) {
      case 'txt':
        return this.cleanText(buffer.toString('utf8'))
      case 'md':
        return this.cleanText(buffer.toString('utf8'))
      case 'pdf': {
        const pdf = (await import('pdf-parse')).default
        const result = await pdf(buffer)
        return this.cleanText(result.text)
      }
      case 'docx': {
        const mammoth = await import('mammoth')
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        // 用 convertToHtml 提取 Word heading 样式（h1~h6），再转 Markdown # 标记
        const result = await mammoth.convertToHtml({ arrayBuffer })
        return this.cleanText(docxHtmlToMd(result.value))
      }
      default:
        // 尝试当文本读
        return this.cleanText(buffer.toString('utf8'))
    }
  }

  /**
   * 文本清洗（成本极低收益明显）
   * 为切块和标题识别提供稳定输入，并让 charCount 更真实：
   * - \r\n / \r → \n（换行归一，Windows 文档常见）
   * - \u0000 等控制字符 → 空格（除 \n\t，防乱码进 chunk）
   * - 连续 3+ 换行压缩为 2（PDF 抽取常见大量空行）
   * - 连续空格压缩为 1（保留缩进结构时 tab 不动）
   * - trim 首尾
   */
  private cleanText(raw: string): string {
    return raw
      .replace(/\r\n/g, '\n') // Windows 换行
      .replace(/\r/g, '\n') // 旧 Mac 换行
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ') // 控制字符（保留 \t=\u0009 \n=\u000A）
      .replace(/\n{3,}/g, '\n\n') // 连续 3+ 换行压缩为 2
      .replace(/[^\S\t\n]{2,}/g, ' ') // 连续空格压缩（[^\S\t\n] = 空格但不含 tab/换行）
      .trim()
  }
}
