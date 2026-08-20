/**
 * SemanticChunker —— 语义分块
 * 对超长 chunk 做语义精修：句级切分 → embedMany 相邻句 cosine 相似度 → 低于阈值处断块
 * （在语义断裂处切，替代超长段直接递归切）；块继承父 chunk 的 headingPath
 * 失败兜底：embedding 异常 → 回退递归细分（不阻塞流水线）
 */
import { Injectable, Logger } from '@nestjs/common'
import { embedMany } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import type { ChunkResult } from './chunk.service'
import type { IndexConfig } from './chunk-config-advisor'

/** 句级分隔（保留分隔符，中文标点 + 换行） */
const SENTENCE_RE = /(?<=[。！？；\n])/

@Injectable()
export class SemanticChunker {
  private readonly logger = new Logger(SemanticChunker.name)

  constructor(private llm: LlmService) {}

  /** 对超长 chunk 语义精修（strategy=SEMANTIC/LLM 时由 StrategyExecutor 调用） */
  async refineChunks(chunks: ChunkResult[], cfg: IndexConfig): Promise<ChunkResult[]> {
    const out: ChunkResult[] = []
    let index = 0
    for (const c of chunks) {
      if (c.content.length <= cfg.chunkSize) {
        out.push({ ...c, index: index++ })
        continue
      }
      const parts = await this.splitBySemantics(c.content, cfg)
      for (const p of parts) out.push({ index: index++, content: p, headingPath: c.headingPath })
    }
    return out
  }

  /** 超长段 → 语义断块（相似度低于阈值处切） */
  private async splitBySemantics(text: string, cfg: IndexConfig): Promise<string[]> {
    try {
      const sentences = text
        .split(SENTENCE_RE)
        .map((s) => s.trim())
        .filter(Boolean)
      if (sentences.length <= 1) return this.recursiveFallback(text, cfg)

      const { embeddings } = await embedMany({ model: this.llm.getEmbeddingModel(), values: sentences })

      // 相邻句相似度 < semanticThreshold → 断点
      const breaks: number[] = []
      for (let i = 1; i < sentences.length; i++) {
        if (cosine(embeddings[i - 1], embeddings[i]) < cfg.semanticThreshold) breaks.push(i)
      }

      // 按断点合并句子成块，每块 ≤ chunkSize（超限块递归细分）
      const parts = this.mergeSentences(sentences, breaks, cfg.chunkSize)
      return parts.length > 0 ? parts : this.recursiveFallback(text, cfg)
    } catch (e) {
      this.logger.warn(`semantic-chunk failed, fallback to recursive: ${e instanceof Error ? e.message : String(e)}`)
      return this.recursiveFallback(text, cfg)
    }
  }

  /** 按断点合并；单块超 chunkSize 时内部再递归细分 */
  private mergeSentences(sentences: string[], breaks: number[], chunkSize: number): string[] {
    const groups: string[][] = []
    let cur: string[] = []
    const breakSet = new Set(breaks)
    for (let i = 0; i < sentences.length; i++) {
      cur.push(sentences[i])
      if (breakSet.has(i + 1)) {
        groups.push(cur)
        cur = []
      }
    }
    if (cur.length > 0) groups.push(cur)

    const out: string[] = []
    for (const g of groups) {
      const joined = g.join('')
      if (joined.length <= chunkSize) {
        out.push(joined)
      } else {
        // 语义断块仍超限 → 按句子拆成多个 ≤ chunkSize 的块（保持句子完整）
        let buf = ''
        for (const s of g) {
          if (buf.length + s.length > chunkSize && buf.length > 0) {
            out.push(buf)
            buf = s
          } else {
            buf += s
          }
        }
        if (buf.length > 0) out.push(buf)
      }
    }
    return out
  }

  /** 递归兜底（语义切分失败时用） */
  private async recursiveFallback(text: string, cfg: IndexConfig): Promise<string[]> {
    const { RecursiveCharacterTextSplitter } = await import('@langchain/textsplitters')
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: cfg.chunkSize,
      chunkOverlap: cfg.overlap,
      separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', ''],
    })
    const chunks = await splitter.splitText(text)
    return chunks.length > 0 ? chunks : [text]
  }
}

/** 余弦相似度 */
function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
