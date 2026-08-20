import { SubQuestionStep } from './sub-question.step'
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

describe('SubQuestionStep', () => {
  it('问题无连词时跳过拆分，emit skipped=true', async () => {
    const llm = { getChatModel: jest.fn() } as unknown as LlmService
    const step = new SubQuestionStep(llm)
    const { emitter, calls } = makeSpyEmitter()
    // 产品价格 不含 和/与/以及/、/或
    const ctx: PlanContext = {
      question: '产品价格',
      sessionId: 's1',
      rewritten: '产品价格',
      subQuestions: [] as string[],
      mode: ExecutionMode.RETRIEVAL,
    }
    await step.execute(ctx, emitter)
    const sqEvent = calls.find((c) => c.step === 'subQuestion')
    expect(sqEvent).toBeDefined()
    expect(sqEvent!.payload).toMatchObject({ skipped: true })
  })
})
