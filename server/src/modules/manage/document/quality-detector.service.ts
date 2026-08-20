/**
 * QualityDetectorService —— 低质量文档检测
 * 返回 GOOD / LOW / UNKNOWN（UNKNOWN = 非 PDF 且文本正常，无判断依据，按 GOOD 放行）
 * 判定逻辑：
 * - PDF：扫描件/加密 PDF 文件大但提取文本极少——启发式 minChars = max(50, fileSize/2000)（近似每页 ≥20 字符）
 * - 其他格式：空文本（< 20 字符）判 LOW
 */
import { Injectable, Logger } from '@nestjs/common'
import type { Document } from '@prisma/client'

export type DocumentQuality = 'GOOD' | 'LOW' | 'UNKNOWN'

@Injectable()
export class QualityDetectorService {
  private readonly logger = new Logger(QualityDetectorService.name)

  async detect(doc: Document, text: string): Promise<DocumentQuality> {
    const len = text.trim().length
    if (doc.fileType === 'pdf') {
      // 每 2KB 文件至少应提取出 1 字符（扫描件/加密 PDF 提取量远低于此）
      const minChars = Math.max(50, Math.floor(doc.fileSize / 2000))
      if (len < minChars) {
        this.logger.warn(`quality LOW: pdf doc=${doc.id} fileSize=${doc.fileSize} chars=${len} minChars=${minChars}`)
        return 'LOW'
      }
      return 'UNKNOWN'
    }
    if (len < 20) {
      this.logger.warn(`quality LOW: ${doc.fileType} doc=${doc.id} chars=${len}`)
      return 'LOW'
    }
    return 'UNKNOWN'
  }
}
