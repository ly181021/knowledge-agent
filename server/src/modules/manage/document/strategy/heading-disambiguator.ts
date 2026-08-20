/**
 * HeadingDisambiguator —— 低置信标题的 LLM 批量判歧
 * 只处理 confidence < DISAMBIG_THRESHOLD 的低置信度标题（交 LLM 判歧）
 * 的启发式候选（即 0.58 的纯启发式命中；正则 1.0 和冒号特征 0.7 不进），批量交 LLM 判定是否真是标题。
 * 成本控制（对齐 LlmSplitter 的护栏思路）：
 * - 候选门槛：候选 <3 个不判歧（1-2 个不值得一次 LLM 调用）
 * - 分批：每批 ≤30 行（防 token 膨胀 + JSON 截断）
 * - 总批数上限 3（90 行，超限放弃判歧走原结果）
 * - 失败静默回退：任一批 LLM 失败 → 保留全部候选（不阻塞切块）
 * 生效场景：判歧只在正则标题不足的文档生效（HeadingDetector 正则命中 ≥2 即早退，启发式才有输出），
 * 即主要服务 PDF/TXT 纯文本（无 markdown # 标记），MD/DOCX 通常正则足够不触发判歧。
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import type { HeadingLine } from './heading-detector'

/** 每批最多候选行数（防 token 膨胀 + LLM 输出 JSON 截断） */
const MAX_BATCH_SIZE = 30
/** 最多判几批（超限放弃判歧，走原结果） */
const MAX_BATCHES = 3
/** 候选数低于此值不判歧（1-2 个不值得调 LLM） */
const MIN_CANDIDATES = 3
/** 判歧阈值：confidence < 此值才判歧（0.58 纯启发式进，0.7 冒号特征不进） */
const DISAMBIG_THRESHOLD = 0.6

interface DisambigVerdict {
  lineNo: number
  isHeading: boolean
}

@Injectable()
export class HeadingDisambiguator {
  private readonly logger = new Logger(HeadingDisambiguator.name)

  constructor(private llm: LlmService) {}

  /**
   * 批量判歧：低置信候选交 LLM 判定是否真是标题。
   * @param headings HeadingDetector.detect 的完整结果（含正则 1.0 + 冒号 0.7 + 启发式 0.58）
   * @param lines 原文按行拆分（提供上下文）
   * @returns 过滤后的 headings（剔除 LLM 判定非标题的；正则/冒号/未覆盖的一律保留）
   */
  async disambiguate(headings: HeadingLine[], lines: string[]): Promise<HeadingLine[]> {
    // 筛判歧候选：只有 confidence < 0.6 的纯启发式进（正则 1.0 + 冒号 0.7 不进）
    const candidates = headings.filter((h) => h.confidence < DISAMBIG_THRESHOLD)
    if (candidates.length < MIN_CANDIDATES) return headings // 候选不足不判

    // 分批调用
    const batches = this.chunkArray(candidates, MAX_BATCH_SIZE)
    const verdicts: DisambigVerdict[] = []
    for (let b = 0; b < batches.length && b < MAX_BATCHES; b++) {
      try {
        const result = await this.batchJudge(batches[b], lines)
        verdicts.push(...result)
      } catch (e) {
        // 任一批失败 → 静默回退，保留全部候选（判歧是增强非必需，不阻塞切块）
        this.logger.warn(
          `heading disambig batch ${b} failed, fallback to original: ${e instanceof Error ? e.message : String(e)}`,
        )
        return headings
      }
    }

    if (batches.length > MAX_BATCHES) {
      this.logger.debug(`heading disambig: ${candidates.length} candidates > ${MAX_BATCHES * MAX_BATCH_SIZE}, 仅判前 ${verdicts.length} 行`)
    }

    // 按判定过滤：isHeading=false 剔除；正则/冒号/LLM 未覆盖的一律保留
    return headings.filter((h) => {
      if (h.confidence >= DISAMBIG_THRESHOLD) return true // 正则 1.0 + 冒号 0.7 不判
      const v = verdicts.find((v) => v.lineNo === h.lineNo)
      return v ? v.isHeading : true // 未覆盖保留（静默回退）
    })
  }

  /** 单批判歧：拼接候选行（带上下文） → generateText → 解析 JSON 数组 */
  private async batchJudge(batch: HeadingLine[], lines: string[]): Promise<DisambigVerdict[]> {
    // 拼接格式：[行号] 上一行 | 当前行（行号 0-based 对齐 HeadingLine.lineNo）
    const candidatesText = batch
      .map((h) => {
        const prev = (lines[h.lineNo - 1] ?? '').trim()
        return `[${h.lineNo}] ${prev} | ${lines[h.lineNo]}`
      })
      .join('\n')

    const prompt = renderPrompt('heading-disambig', { candidates: candidatesText })
    const { text: raw } = await generateText({
      model: this.llm.getChatModel(),
      system: '你是文档结构分析助手。只输出 JSON，不要解释。',
      prompt,
    })

    return this.parseVerdicts(raw)
  }

  /** 从 LLM 输出提取 JSON 数组（容错 markdown 代码块/前后缀；判歧返回 [..] 非 {..}） */
  private parseVerdicts(raw: string): DisambigVerdict[] {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start < 0 || end <= start) throw new Error('LLM 未返回 JSON 数组')
    const json = raw.slice(start, end + 1)
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) throw new Error('LLM 返回非数组')
    return parsed.filter(
      (v): v is DisambigVerdict =>
        v != null && typeof v === 'object' && typeof (v as DisambigVerdict).lineNo === 'number' && typeof (v as DisambigVerdict).isHeading === 'boolean',
    )
  }

  /** 数组分批工具 */
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }
}
