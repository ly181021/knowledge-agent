import { RewriteStep } from './rewrite.step'
import type { ProgressEmitter, ProgressEvent } from '../progress-emitter'
import type { PlanContext } from './plan-context'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { LlmService } from '@/modules/infra/llm.provider'

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

function makeCtx(question: string): PlanContext {
  return {
    question,
    sessionId: 's1',
    rewritten: '',
    subQuestions: [] as string[],
    mode: ExecutionMode.RETRIEVAL,
  }
}

describe('RewriteStep', () => {
  it('问题 >15 字且无问号时跳过改写，emit skipped=true', async () => {
    const llm = { getChatModel: jest.fn() } as unknown as LlmService
    const step = new RewriteStep(llm)
    const { emitter, calls } = makeSpyEmitter()
    const ctx = makeCtx('这是一个非常长的产品价格问题文本内容')
    await step.execute(ctx, emitter)
    const rewriteEvent = calls.find((c) => c.step === 'rewrite')
    expect(rewriteEvent).toBeDefined()
    expect(rewriteEvent!.payload).toMatchObject({ skipped: true })
    expect(rewriteEvent!.payload).toHaveProperty('from')
    expect(rewriteEvent!.payload).toHaveProperty('to')
  })

  it('不传 emitter 不报错（向后兼容）', async () => {
    const llm = { getChatModel: jest.fn() } as unknown as LlmService
    const step = new RewriteStep(llm)
    const ctx = makeCtx('这是一个非常长的产品价格问题文本内容')
    await expect(step.execute(ctx)).resolves.toBeUndefined()
  })
})
