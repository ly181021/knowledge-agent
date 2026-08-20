/**
 * RagService —— RAG 引擎（双通道 + RRF）
 * 支持多子问题并行检索，每个子问题双通道 → 合并去重 → RRF 融合 → topK=5
 */
import { Injectable, Logger } from '@nestjs/common'
import { VectorChannel } from './channel/vector.channel'
import { KeywordChannel } from './channel/keyword.channel'
import type { RetrievalResult } from './channel/retrieval-channel'
import type { Citation, RagResult, ChannelStat, ChunkScore } from './rag.types'
import { PrismaService } from '@/prisma/prisma.service'

/** RRF 常数 */
const RRF_K = 60
/** 最终给 LLM 的证据数 */
const FINAL_TOP_K = 5
/** 总证据字符上限 */
const TOTAL_EVIDENCE_MAX_CHARS = 5200
/**
 * RRF 候选过滤阈值：chunk 至少在一个通道里 rank ≤ 此值才保留。
 * 防止多子问题场景下，一个在所有通道都排靠后的不相关 chunk
 * 因被多次错误召回而 RRF 分数累加放大、反超正确 chunk。
 */
const RRF_MAX_RANK = 3

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name)

  constructor(
    private vectorChannel: VectorChannel,
    private keywordChannel: KeywordChannel,
    private prisma: PrismaService,
  ) {}

  /**
   * 检索：支持单问题或多子问题
   * @param question 单个问题（向后兼容）
   * @param subQuestions 多个子问题，如有则每个子问题并行检索后合并
   * @param options.documentIds 限定文档 id 集合（当前文档问答模式用），为空时全库
   */
  async retrieve(
    question: string,
    subQuestions?: string[],
    options?: { documentIds?: string[] },
  ): Promise<RagResult> {
    const t0 = Date.now()
    const questions = subQuestions && subQuestions.length > 1 ? subQuestions : [question]
    const filterDocIds = options?.documentIds

    // 1. 每个子问题双通道并行
    const perQuestionResults = await Promise.all(
      questions.map(async (q) => {
        const [vec, kw] = await Promise.all([
          this.vectorChannel.retrieve(q, 8, filterDocIds),
          this.keywordChannel.retrieve(q, 8, filterDocIds),
        ])
        return { vector: vec, keyword: kw }
      }),
    )

    // 2. 合并所有子问题的通道结果
    const allVector = perQuestionResults.flatMap((r) => r.vector)
    const allKeyword = perQuestionResults.flatMap((r) => r.keyword)
    const durationMs = Date.now() - t0

    // 3. RRF 融合（所有通道结果一起融合，自动去重 + RRF_MAX_RANK 过滤）
    const fused = this.rrfFuse([allVector, allKeyword])

    // 4. 取 topK
    const top = fused.slice(0, FINAL_TOP_K)
    const topIds = new Set(top.map((r) => r.id))

    // 5. 组装 channels 统计（recalled 用融合前总数，便于看板看通道召回量）
    const channels: ChannelStat[] = [
      { channel: 'vector', recalled: allVector.length, accepted: allVector.filter((r) => topIds.has(r.id)).length, durationMs },
      { channel: 'keyword', recalled: allKeyword.length, accepted: allKeyword.filter((r) => topIds.has(r.id)).length, durationMs },
    ]

    // 6. 组装 results（含 RRF_MAX_RANK 过滤后的 fused，便于看板对比 RRF 前后）
    const results: ChunkScore[] = fused.map((r, i) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      vectorScore: allVector.find((v) => v.id === r.id)?.score,
      keywordScore: allKeyword.find((k) => k.id === r.id)?.score,
      rrfScore: r.score,
      accepted: i < FINAL_TOP_K,
      rank: i,
    }))

    if (top.length === 0) {
      this.logger.warn(`RAG 无召回结果，question=${question.slice(0, 80)}`)
      return { evidence: '', citations: [], channels, results }
    }

    // 7. 组装 evidence + citations（Parent-Child 提升 ：命中 child → 提升到 parent 大块，保证上下文完整）
    const parentMap = await this.fetchParentContents(top.map((r) => r.chunkId))
    const evidenceParts: string[] = []
    const citations: Citation[] = top.map((r, i) => {
      const parentContent = parentMap.get(r.chunkId)
      const content = parentContent ?? r.content // 无 parent（老数据/未聚合）→ 用 child 内容，行为与现状一致
      evidenceParts.push(`[引用${i + 1}] ${content}`)
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        content: content.slice(0, 200),
        score: r.score,
        rank: i,
      }
    })

    let evidence = evidenceParts.join('\n\n')
    if (evidence.length > TOTAL_EVIDENCE_MAX_CHARS) {
      evidence = evidence.slice(0, TOTAL_EVIDENCE_MAX_CHARS) + '...'
    }

    this.logger.log(
      `RAG retrieve: subQ=${questions.length} ` +
      `vector=${allVector.length} keyword=${allKeyword.length} ` +
      `fused=${fused.length} final=${top.length}` +
      (filterDocIds ? ` docScope=${filterDocIds.length}` : ''),
    )
    return { evidence, citations, channels, results }
  }

  /**
   * Parent-Child 读取端：child id → parent content（DocumentChunk.parentBlockId → DocumentParentBlock）
   * 无 parent 的 child 不进 Map（调用方回退用 child 原文）
   */
  private async fetchParentContents(childIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    if (childIds.length === 0) return map
    const chunks = await this.prisma.documentChunk.findMany({
      where: { id: { in: childIds }, parentBlockId: { not: null } },
      select: { id: true, parentBlockId: true },
    })
    const parentIds = [...new Set(chunks.map((c) => c.parentBlockId!))]
    if (parentIds.length === 0) return map
    const parents = await this.prisma.documentParentBlock.findMany({
      where: { id: { in: parentIds } },
      select: { id: true, content: true },
    })
    const parentContent = new Map(parents.map((p) => [p.id, p.content]))
    for (const c of chunks) {
      const content = parentContent.get(c.parentBlockId!)
      if (content) map.set(c.id, content)
    }
    return map
  }

  /**
   * RRF 融合：score = Σ 1/(k+rank)
   * 同一 chunk 出现在多个子问题/通道时，分数累加（自动去重）
   * 加 RRF_MAX_RANK 过滤——
   * 一个 chunk 在所有通道里都排在 RRF_MAX_RANK 之外（即每个通道都不是 top3）时直接丢弃，
   * 防止所有通道都靠后但被多子问题累加放大的不相关 chunk 反超正确答案。
   */
  private rrfFuse(channels: RetrievalResult[][]): RetrievalResult[] {
    // 先按通道过滤：每个 chunk 在该通道的 rank 必须 ≤ RRF_MAX_RANK 才计入本次融合
    const filteredChannels = channels.map((channelResults) =>
      channelResults.filter((r) => r.rank < RRF_MAX_RANK),
    )

    const scoreMap = new Map<string, { result: RetrievalResult; score: number }>()

    for (const channelResults of filteredChannels) {
      for (const r of channelResults) {
        const cur = scoreMap.get(r.id)
        const rrfScore = 1 / (RRF_K + r.rank)
        if (cur) {
          cur.score += rrfScore
        } else {
          scoreMap.set(r.id, { result: r, score: rrfScore })
        }
      }
    }

    return [...scoreMap.entries()]
      .sort(([, a], [, b]) => b.score - a.score)
      .map(([, v]) => ({ ...v.result, score: v.score }))
  }
}
