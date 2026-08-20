import { ScopeShrinkStep } from './scope-shrink.step'
import type { ProgressEmitter, ProgressEvent } from '../progress-emitter'
import type { PlanContext } from './plan-context'
import { ExecutionMode } from '@/common/enums/execution-mode'

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

describe('ScopeShrinkStep', () => {
  it('emit skipped=true（当前空操作）', async () => {
    const step = new ScopeShrinkStep()
    const { emitter, calls } = makeSpyEmitter()
    const ctx: PlanContext = {
      question: 'q',
      sessionId: 's1',
      rewritten: 'q',
      subQuestions: ['q'],
      mode: ExecutionMode.RETRIEVAL,
    }
    await step.execute(ctx, emitter)
    const ssEvent = calls.find((c) => c.step === 'scopeShrink')
    expect(ssEvent).toBeDefined()
    expect(ssEvent!.payload).toEqual({ skipped: true })
  })
})
