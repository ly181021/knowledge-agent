/**
 * ChunkService —— 切块策略
 * 组合切块（结构主干 + 递归兜底）
 * - 有标题（#/数字编号/第N章等）→ StructureChunkService 按章节切 + 超长语义细分
 * - 无标题 → RecursiveCharacterTextSplitter 递归兜底（chunkSize=800, overlap=120）
 * 调用方 document.service 无需感知结构切块，split 内部自动判定。
 */
import { Injectable, Logger } from '@nestjs/common'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { StructureChunkService, type ChunkOptions } from './structure-chunk.service'
import type { HeadingLine } from './heading-detector'

export interface ChunkResult {
  index: number
  content: string
  /** 结构切块产出的标题路径（如 ['产品手册', '安装', '1.1 环境要求']）；递归兜底时为 undefined */
  headingPath?: string[]
}

/** ：split 返回 chunks + headings（供 consumer 构建结构节点；RECURSIVE 路径 headings=undefined） */
export interface SplitResult {
  chunks: ChunkResult[]
  headings?: HeadingLine[]
}

@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name)
  /** 递归兜底切分器（结构切块内部超长细分也复用它） */
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 120,
    separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', ''],
  })

  constructor(private structureChunker: StructureChunkService) {}

  /**
   * 切块入口：优先结构切块，无标题自动回退递归
   * @param text 解析后的文本（MD 带 #，DOCX 转带 # 的 markdown，PDF/TXT 纯文本）
   * @param opts 按文档配置的切块参数（默认 800/120）
   */
  async split(text: string, opts?: ChunkOptions): Promise<SplitResult> {
    // 委托 StructureChunkService：有标题按章节切，无标题内部回退递归
    const result = await this.structureChunker.split(text, opts)
    this.logger.log(`split into ${result.chunks.length} chunks (structured=${result.chunks.some((c) => c.headingPath)})`)
    return result
  }
}
