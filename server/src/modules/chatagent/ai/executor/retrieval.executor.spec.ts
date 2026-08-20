import { RetrievalExecutor } from './retrieval.executor'
import type { RagService } from '@/modules/chatagent/rag/rag.service'
import type { SummaryMemory } from '@/modules/chatagent/memory/summary.memory'
import type { ConversationExecutionPlan } from '../execution-plan'
import type { ProgressEmitter, ProgressEvent } from '../progress-emitter'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'

function makeSpyEmitter(): { emitter: ProgressEmitter; calls: ProgressEvent[] } {
  const calls: ProgressEvent[] = []
  return { emitter: { emit: (e) => calls.push(e) }, calls }
}

describe('RetrievalExecutor', () => {
  it('检索完成后 emit retrieval 带通道统计 + topK', async () => {
    const ragResult = {
      evidence: '[1] 证据',
      citations: [{ chunkId: 'c1', documentId: 'd1', content: '证据', score: 0.9, rank: 0 }],
      channels: [
        { channel: 'vector', recalled: 8, accepted: 3, durationMs: 50 },
        { channel: 'keyword', recalled: 5, accepted: 2, durationMs: 30 },
      ],
      results: [],
    }
    const rag = { retrieve: jest.fn().mockResolvedValue(ragResult) } as unknown as RagService
    const memory = { load: jest.fn().mockResolvedValue([]) } as unknown as SummaryMemory
    const executor = new RetrievalExecutor(rag, memory)

    const plan: ConversationExecutionPlan = {
      sessionId: 's1',
      question: '价格',
      rewritten: '产品价格',
      subQuestions: ['产品价格'],
      mode: ExecutionMode.RETRIEVAL,
    }
    const { emitter, calls } = makeSpyEmitter()
    await executor.prepare(plan, emitter)

    const retrievalEvent = calls.find((c) => c.step === 'retrieval')
    expect(retrievalEvent).toBeDefined()
    const payload = retrievalEvent!.payload
    // 显式断言 channel→name 字段重命名 + 完整 payload 形状
    expect(payload.channels).toEqual([
      expect.objectContaining({ name: 'vector', recalled: 8, accepted: 3, durationMs: 50 }),
      expect.objectContaining({ name: 'keyword', recalled: 5, accepted: 2, durationMs: 30 }),
    ])
    expect(payload.fusedCount).toBe(0)
    expect(payload.topK).toBe(1)
  })

  it('不传 emitter 不报错（向后兼容）', async () => {
    const rag = { retrieve: jest.fn().mockResolvedValue({ evidence: '', citations: [], channels: [], results: [] }) } as unknown as RagService
    const memory = { load: jest.fn().mockResolvedValue([]) } as unknown as SummaryMemory
    const executor = new RetrievalExecutor(rag, memory)
    const plan = { sessionId: 's1', question: 'q', rewritten: 'q', subQuestions: ['q'], mode: ExecutionMode.RETRIEVAL } as ConversationExecutionPlan
    await expect(executor.prepare(plan)).resolves.toBeDefined()
  })

  it('emitter.emit 抛错时不中断检索', async () => {
    const rag = { retrieve: jest.fn().mockResolvedValue({ evidence: '', citations: [], channels: [], results: [] }) } as unknown as RagService
    const memory = { load: jest.fn().mockResolvedValue([]) } as unknown as SummaryMemory
    const executor = new RetrievalExecutor(rag, memory)
    const throwingEmitter: ProgressEmitter = { emit: () => { throw new Error('boom') } }
    const plan = { sessionId: 's1', question: 'q', rewritten: 'q', subQuestions: ['q'], mode: ExecutionMode.RETRIEVAL } as ConversationExecutionPlan
    const ctx = await executor.prepare(plan, throwingEmitter)
    expect(ctx).toBeDefined()
    // 检索仍完成，citations 是空数组
    expect(ctx.citations).toEqual([])
  })

  describe('chatMode 文档过滤透传', () => {
    it('DOCUMENT 模式把 selectedDocumentId 作为 documentIds 传给 RagService', async () => {
      const rag = {
        retrieve: jest.fn().mockResolvedValue({ evidence: '', citations: [], channels: [], results: [] }),
      } as unknown as RagService
      const memory = { load: jest.fn().mockResolvedValue([]) } as unknown as SummaryMemory
      const executor = new RetrievalExecutor(rag, memory)

      const plan: ConversationExecutionPlan = {
        sessionId: 's1',
        question: '价格',
        rewritten: '产品价格',
        subQuestions: ['产品价格'],
        mode: ExecutionMode.RETRIEVAL,
        chatMode: ChatQueryMode.DOCUMENT,
        selectedDocumentId: 'doc-xyz',
      }
      await executor.prepare(plan)
      expect(rag.retrieve).toHaveBeenCalledWith('产品价格', ['产品价格'], { documentIds: ['doc-xyz'] })
    })

    it('AUTO_DOCUMENT / 未传 chatMode 时不传 documentIds（全库）', async () => {
      const rag = {
        retrieve: jest.fn().mockResolvedValue({ evidence: '', citations: [], channels: [], results: [] }),
      } as unknown as RagService
      const memory = { load: jest.fn().mockResolvedValue([]) } as unknown as SummaryMemory
      const executor = new RetrievalExecutor(rag, memory)

      const plan: ConversationExecutionPlan = {
        sessionId: 's1',
        question: 'q',
        rewritten: 'q',
        subQuestions: ['q'],
        mode: ExecutionMode.RETRIEVAL,
        chatMode: ChatQueryMode.AUTO_DOCUMENT,
      }
      await executor.prepare(plan)
      expect(rag.retrieve).toHaveBeenCalledWith('q', ['q'], { documentIds: undefined })
    })
  })
})
