/**
 * LlmSplitter —— LLM 智能切块（/ ，默认关闭）
 * 触发：cfg.llmSplitEnabled=true 且 quality=LOW（扫描件/低质量文本，正则与 embedding 都不可靠的场景）
 * 对超长 chunk 调 LLM 输出语义切分边界（JSON { boundaries: number[] }，行号从 0 开始）
 * 成本护栏：单文档最多 20 次调用；失败/解析异常 → 回退原 chunk（不阻塞流水线）
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import type { ChunkResult } from './chunk.service'
import type { IndexConfig } from './chunk-config-advisor'

/** 单文档 LLM 切分调用上限（对齐 ModelCallLimitHook 思路） */
const MAX_LLM_SPLIT_CALLS = 20

@Injectable()
export class LlmSplitter {
  private readonly logger = new Logger(LlmSplitter.name)

  constructor(private llm: LlmService) {}

  /** LLM 增强切块（pipeline 含 LLM 且 quality=LOW 时执行；非 LOW 原样返回） */
  async enhance(chunks: ChunkResult[], cfg: IndexConfig, quality?: string | null): Promise<ChunkResult[]> {
    // pipeline 已决定是否调用 LLM；此处只在 quality 非 LOW 时跳过（LLM 切块专为低质量文档设计）
    if (quality !== 'LOW') return chunks

    const out: ChunkResult[] = []
    let index = 0
    let calls = 0
    for (const c of chunks) {
      if (c.content.length > cfg.chunkSize && calls < MAX_LLM_SPLIT_CALLS) {
        const parts = await this.splitWithLlm(c.content)
        calls++
        if (parts.length > 1) {
          for (const p of parts) out.push({ index: index++, content: p, headingPath: c.headingPath })
          continue
        }
      }
      out.push({ ...c, index: index++ })
    }
    return out
  }

  /** 单段 LLM 切分：结构化输出 boundaries（行号），失败回退原文本 */
  private async splitWithLlm(text: string): Promise<string[]> {
    try {
      const prompt = renderPrompt('document-llm-split', { content: text })
      const { text: raw } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是文档切分助手。只输出 JSON，不要解释。',
        prompt,
      })
      const parsed: { boundaries?: number[] } = JSON.parse(extractJson(raw))
      const boundaries = (parsed.boundaries ?? []).filter((n) => Number.isInteger(n) && n > 0 && n < text.length)
      if (boundaries.length === 0) return [text]

      const lines = text.split('\n')
      const parts: string[] = []
      let start = 0
      for (const b of boundaries) {
        if (b <= start) continue
        parts.push(lines.slice(start, b).join('\n'))
        start = b
      }
      if (start < lines.length) parts.push(lines.slice(start).join('\n'))
      return parts.length > 1 ? parts : [text]
    } catch (e) {
      this.logger.warn(`llm-split failed, keep original chunk: ${e instanceof Error ? e.message : String(e)}`)
      return [text]
    }
  }
}

/** 从 LLM 输出中提取 JSON 对象（容错 markdown 代码块/前后缀）。 导出供 document-profile.service 复用 */
export function extractJson(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw
}
