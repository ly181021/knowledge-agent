/**
 * RagService 单测 —— RAG 引擎
 * 覆盖：
 * - 单/多子问题分发（channels 调用次数）
 * - RRF 融合（同 chunk 跨通道累加去重 + RRF_MAX_RANK=3 过滤）
 * - FINAL_TOP_K=5 截断 / TOTAL_EVIDENCE_MAX_CHARS=5200 截断
 * - Parent-Child 提升（有 parent 用 parent content；无 parent 回退 child）
 * - citation 200 字截断 / accepted+rank 字段组装 / 无召回返回空
 * 风格：手写 mock + 直接 new（与项目主流 spec 一致，避免 @nestjs/testing 触发副作用）。
 * rrfFuse 是 private，通过 retrieve 间接测——精心构造 channel 返回的 rank 数据来验证融合语义。
 */
import { RagService } from './rag.service'
import type { RetrievalResult } from './channel/retrieval-channel'

/** 构造一条 channel 返回结果（id 决定去重，rank 决定 RRF 分数与过滤） */
function hit(id: string, rank: number, content = `content-${id}`, documentId = 'doc-1'): RetrievalResult {
  return { id, chunkId: `chunk-${id}`, documentId, content, score: 1 - rank * 0.1, rank }
}

describe('RagService', () => {
  let service: RagService
  let vectorChannel: { retrieve: jest.Mock }
  let keywordChannel: { retrieve: jest.Mock }
  let prisma: {
    documentChunk: { findMany: jest.Mock }
    documentParentBlock: { findMany: jest.Mock }
  }

  beforeEach(() => {
    vectorChannel = { retrieve: jest.fn() }
    keywordChannel = { retrieve: jest.fn() }
    prisma = {
      documentChunk: { findMany: jest.fn().mockResolvedValue([]) },
      documentParentBlock: { findMany: jest.fn().mockResolvedValue([]) },
    }
    service = new RagService(
      vectorChannel as never,
      keywordChannel as never,
      prisma as never,
    )
  })

  it('单子问题（subQuestions 为空）→ channels 各调 1 次', async () => {
    vectorChannel.retrieve.mockResolvedValue([hit('a', 0)])
    keywordChannel.retrieve.mockResolvedValue([hit('a', 0)])

    await service.retrieve('问题')

    expect(vectorChannel.retrieve).toHaveBeenCalledTimes(1)
    expect(keywordChannel.retrieve).toHaveBeenCalledTimes(1)
    // 默认 topK=8
    expect(vectorChannel.retrieve.mock.calls[0][1]).toBe(8)
  })

  it('多子问题（length>1）→ channels 各调 N 次，结果 flatMap 合并', async () => {
    vectorChannel.retrieve
      .mockResolvedValueOnce([hit('a', 0)])
      .mockResolvedValueOnce([hit('b', 0)])
    keywordChannel.retrieve
      .mockResolvedValueOnce([hit('a', 1)])
      .mockResolvedValueOnce([hit('c', 0)])

    const res = await service.retrieve('主问题', ['子问题1', '子问题2'])

    expect(vectorChannel.retrieve).toHaveBeenCalledTimes(2)
    expect(keywordChannel.retrieve).toHaveBeenCalledTimes(2)
    // channels.recalled 是融合前总数：vector 2、keyword 2
    expect(res.channels[0]).toMatchObject({ channel: 'vector', recalled: 2 })
    expect(res.channels[1]).toMatchObject({ channel: 'keyword', recalled: 2 })
  })

  it('RRF 融合：同 chunk 跨通道累加 → 排第一', async () => {
    // chunk-a 在两个通道都 rank=0 → 分数最高（1/60 + 1/60）
    // chunk-b 只在 vector rank=0 → 分数较低（1/60）
    vectorChannel.retrieve.mockResolvedValue([hit('a', 0), hit('b', 1)])
    keywordChannel.retrieve.mockResolvedValue([hit('a', 1)])

    const res = await service.retrieve('q')

    // a 累加后应排第 0
    expect(res.citations[0].chunkId).toBe('chunk-a')
    expect(res.citations[1].chunkId).toBe('chunk-b')
    // results 里 a 的 rrfScore 应大于 b
    const aScore = res.results.find((r) => r.chunkId === 'chunk-a')!.rrfScore
    const bScore = res.results.find((r) => r.chunkId === 'chunk-b')!.rrfScore
    expect(aScore).toBeGreaterThan(bScore)
  })

  it('RRF_MAX_RANK=3 过滤：rank≥3 的 chunk 被丢弃，不进 results', async () => {
    // rank=2 保留（< 3），rank=3 丢弃（≥ 3）
    vectorChannel.retrieve.mockResolvedValue([hit('keep', 2), hit('drop', 3)])
    keywordChannel.retrieve.mockResolvedValue([])

    const res = await service.retrieve('q')

    expect(res.results.find((r) => r.chunkId === 'chunk-keep')).toBeTruthy()
    expect(res.results.find((r) => r.chunkId === 'chunk-drop')).toBeFalsy()
  })

  it('FINAL_TOP_K=5 截断：8 条候选 → citations 只含 5 条，results 全量但 accepted 只 top5=true', async () => {
    // 给 8 条不同的 chunk，让它们都过 RRF_MAX_RANK（rank 0-2 都合法）
    const vHits = [0, 1, 2, 3].map((r) => hit(`v${r}`, r)) // 注意 r=3 会被过滤
    const kHits = [0, 1, 2, 3, 4].map((r) => hit(`k${r}`, r)) // r=3,4 会被过滤，剩 3 条
    vectorChannel.retrieve.mockResolvedValue(vHits)
    keywordChannel.retrieve.mockResolvedValue(kHits)

    const res = await service.retrieve('q')

    // 融合后 = v0,v1,v2 (v3过滤) + k0,k1,k2 (k3,k4过滤) = 6 条；top5 截断
    expect(res.citations).toHaveLength(5)
    // accepted=true 的恰好 5 条
    expect(res.results.filter((r) => r.accepted)).toHaveLength(5)
    // rank 字段是融合后序号，递增
    expect(res.results.map((r) => r.rank)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('TOTAL_EVIDENCE_MAX_CHARS=5200 截断：超长 evidence 末尾加 ...', async () => {
    // 单条 evidence 约 6000 字（[引用1] + 5900+ 内容） → 超 5200
    const longContent = 'X'.repeat(6000)
    vectorChannel.retrieve.mockResolvedValue([hit('a', 0, longContent)])
    keywordChannel.retrieve.mockResolvedValue([])

    const res = await service.retrieve('q')

    expect(res.evidence.length).toBeLessThanOrEqual(5200 + 3) // 上限 5200 + 截断省略号 3 字符
    expect(res.evidence.endsWith('...')).toBe(true)
  })

  it('无召回（双通道都空）→ evidence 空、citations 空、channels.accepted 全 0', async () => {
    vectorChannel.retrieve.mockResolvedValue([])
    keywordChannel.retrieve.mockResolvedValue([])

    const res = await service.retrieve('q')

    expect(res.evidence).toBe('')
    expect(res.citations).toEqual([])
    expect(res.channels[0].accepted).toBe(0)
    expect(res.channels[1].accepted).toBe(0)
  })

  it('Parent-Child 提升：有 parentBlockId → evidence 用 parent content', async () => {
    vectorChannel.retrieve.mockResolvedValue([hit('a', 0, 'child 原文')])
    keywordChannel.retrieve.mockResolvedValue([])
    // fetchParentContents 入参是 top.map(r => r.chunkId) = ['chunk-a']
    prisma.documentChunk.findMany.mockResolvedValue([
      { id: 'chunk-a', parentBlockId: 'parent-1' },
    ])
    prisma.documentParentBlock.findMany.mockResolvedValue([
      { id: 'parent-1', content: 'parent 大块内容' },
    ])

    const res = await service.retrieve('q')

    expect(res.evidence).toContain('parent 大块内容')
    expect(res.evidence).not.toContain('child 原文')
    // citation 用 parent content
    expect(res.citations[0].content).toContain('parent 大块内容')
  })

  it('citation 200 字截断：长 content 的 citation.content ≤ 200', async () => {
    const longContent = 'Y'.repeat(500)
    vectorChannel.retrieve.mockResolvedValue([hit('a', 0, longContent)])
    keywordChannel.retrieve.mockResolvedValue([])

    const res = await service.retrieve('q')

    expect(res.citations[0].content.length).toBeLessThanOrEqual(200)
    // evidence 不截断（evidence 是另一套 5200 上限）
    expect(res.evidence.length).toBeGreaterThan(200)
  })
})
