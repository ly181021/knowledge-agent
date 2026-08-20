import { Test } from '@nestjs/testing'
import { PreparationOrchestrator } from './orchestrator'
import { RewriteStep } from './rewrite.step'
import { SubQuestionStep } from './sub-question.step'
import { ScopeShrinkStep } from './scope-shrink.step'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'
import type { ProgressEmitter, ProgressEvent } from '../progress-emitter'

/**
 * 构造一个 spy emitter，记录所有 emit 调用
 */
function makeSpyEmitter(): { emitter: ProgressEmitter; calls: ProgressEvent[] } {
  const calls: ProgressEvent[] = []
  return {
    emitter: { emit: (e) => calls.push(e) },
    calls,
  }
}

describe('PreparationOrchestrator', () => {
  let orchestrator: PreparationOrchestrator
  let rewrite: RewriteStep
  let subQuestion: SubQuestionStep
  let scopeShrink: ScopeShrinkStep

  beforeEach(async () => {
    // 用 mock 实例避免触发真实 LLM 调用
    rewrite = { execute: jest.fn() } as unknown as RewriteStep
    subQuestion = { execute: jest.fn() } as unknown as SubQuestionStep
    scopeShrink = { execute: jest.fn() } as unknown as ScopeShrinkStep

    const moduleRef = await Test.createTestingModule({
      providers: [
        PreparationOrchestrator,
        { provide: RewriteStep, useValue: rewrite },
        { provide: SubQuestionStep, useValue: subQuestion },
        { provide: ScopeShrinkStep, useValue: scopeShrink },
      ],
    }).compile()
    orchestrator = moduleRef.get(PreparationOrchestrator)
  })

  it('不传 emitter 时不报错（向后兼容）', async () => {
    await expect(orchestrator.prepare('产品价格', 'sess-1')).resolves.toBeDefined()
  })

  it('传 emitter 后，按顺序 emit 责任链各步骤（RETRIEVAL happy path）', async () => {
    const { emitter, calls } = makeSpyEmitter()
    const plan = await orchestrator.prepare('产品价格是多少', 'sess-1', emitter)
    // 问题 ≥5 字符且非纯标点 → 走 RETRIEVAL 而非 CLARIFICATION
    expect(plan.mode).toBe(ExecutionMode.RETRIEVAL)
    expect(calls.some((c) => c.step === 'clarification')).toBe(false)
    // 完整顺序断言：rewrite/subQuestion/scopeShrink 现下沉到 step 内部 emit，
    // orchestrator.spec 用 mock step（{ execute: jest.fn }）不会触发 emit，
    // 因此 spy 只捕获 orchestrator 直发的 route（RETRIEVAL happy path 无 clarification）
    const steps = calls.map((c) => c.step)
    expect(steps).toEqual(['route'])
    const routeEvent = calls.find((c) => c.step === 'route')!
    expect(routeEvent.payload).toEqual({ mode: ExecutionMode.RETRIEVAL })
  })

  it('emitter.emit 抛错时不中断 prepare', async () => {
    const throwingEmitter: ProgressEmitter = {
      emit: () => {
        throw new Error('boom')
      },
    }
    const plan = await orchestrator.prepare('产品价格是多少', 'sess-1', throwingEmitter)
    expect(plan).toBeDefined()
    expect(plan.question).toBe('产品价格是多少')
    expect(plan.mode).toBe(ExecutionMode.RETRIEVAL)
    expect(plan.rewritten).toBe('产品价格是多少')
  })

  it('问题太短（<5字）时 emit clarification + route=CLARIFICATION', async () => {
    const { emitter, calls } = makeSpyEmitter()
    const plan = await orchestrator.prepare('价格', 'sess-1', emitter)
    const clarEvent = calls.find((c) => c.step === 'clarification')
    expect(clarEvent?.payload).toEqual({ mode: 'CLARIFICATION', reason: 'too_short' })
    expect(plan.mode).toBe(ExecutionMode.CLARIFICATION)
    const routeEvent = calls.find((c) => c.step === 'route')!
    expect(routeEvent.payload).toEqual({ mode: 'CLARIFICATION' })
  })

  describe('chatMode 分流（三种问答模式）', () => {
    it('OPEN_CHAT → REACT_AGENT，且跳过 clarification（问题太短也尊重用户模式）', async () => {
      const { emitter, calls } = makeSpyEmitter()
      const plan = await orchestrator.prepare('价格', 'sess-1', emitter, {
        chatMode: ChatQueryMode.OPEN_CHAT,
      })
      expect(plan.mode).toBe(ExecutionMode.REACT_AGENT)
      expect(plan.chatMode).toBe(ChatQueryMode.OPEN_CHAT)
      // 问题 <5 字也不应触发 clarification（用户已显式选模式）
      expect(calls.some((c) => c.step === 'clarification')).toBe(false)
      const routeEvent = calls.find((c) => c.step === 'route')!
      expect(routeEvent.payload).toEqual({ mode: ExecutionMode.REACT_AGENT })
    })

    it('DOCUMENT → RETRIEVAL，并透传 selectedDocumentId', async () => {
      const { emitter, calls } = makeSpyEmitter()
      const plan = await orchestrator.prepare('产品价格是多少', 'sess-1', emitter, {
        chatMode: ChatQueryMode.DOCUMENT,
        selectedDocumentId: 'doc-abc',
      })
      expect(plan.mode).toBe(ExecutionMode.RETRIEVAL)
      expect(plan.chatMode).toBe(ChatQueryMode.DOCUMENT)
      expect(plan.selectedDocumentId).toBe('doc-abc')
      const routeEvent = calls.find((c) => c.step === 'route')!
      expect(routeEvent.payload).toEqual({ mode: ExecutionMode.RETRIEVAL })
    })

    it('AUTO_DOCUMENT → RETRIEVAL', async () => {
      const { emitter, calls } = makeSpyEmitter()
      const plan = await orchestrator.prepare('产品价格是多少', 'sess-1', emitter, {
        chatMode: ChatQueryMode.AUTO_DOCUMENT,
      })
      expect(plan.mode).toBe(ExecutionMode.RETRIEVAL)
      expect(plan.chatMode).toBe(ChatQueryMode.AUTO_DOCUMENT)
      expect(plan.selectedDocumentId).toBeUndefined()
      const routeEvent = calls.find((c) => c.step === 'route')!
      expect(routeEvent.payload).toEqual({ mode: ExecutionMode.RETRIEVAL })
    })

    it('不传 chatMode 时保持旧行为（问题太短 → CLARIFICATION）', async () => {
      const { emitter, calls } = makeSpyEmitter()
      const plan = await orchestrator.prepare('价格', 'sess-1', emitter)
      expect(plan.mode).toBe(ExecutionMode.CLARIFICATION)
      expect(plan.chatMode).toBeUndefined()
      expect(calls.some((c) => c.step === 'clarification')).toBe(true)
    })
  })
})
