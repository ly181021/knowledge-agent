import { describe, it, expect } from 'vitest'
import { traceStagesToThinkingSteps, type TraceStageLike } from '../trace-transform'

describe('traceStagesToThinkingSteps', () => {
  it('把 TraceStage[] 转成 ThinkingStep[]（按 startedAt 排序）', () => {
    const stages = [
      { stage: 'route', state: 'done', output: { mode: 'RETRIEVAL' }, startedAt: new Date('2026-07-29T10:00:02Z'), durationMs: 1 },
      { stage: 'rewrite', state: 'done', output: { from: 'a', to: 'b', skipped: false }, startedAt: new Date('2026-07-29T10:00:00Z'), durationMs: 50 },
    ]
    const steps = traceStagesToThinkingSteps(stages as unknown as TraceStageLike[])
    expect(steps).toHaveLength(2)
    expect(steps[0]!.step).toBe('rewrite')
    expect(steps[1]!.step).toBe('route')
    expect(steps[0]!.payload).toEqual({ from: 'a', to: 'b', skipped: false })
    expect(steps[0]!.ts).toBe(new Date('2026-07-29T10:00:00Z').getTime())
  })

  it('过滤掉 stage 为空的行', () => {
    const stages = [
      { stage: 'rewrite', state: 'done', output: {}, startedAt: new Date(), durationMs: null },
      { stage: '', state: 'done', output: {}, startedAt: new Date(), durationMs: null },
    ]
    const steps = traceStagesToThinkingSteps(stages as unknown as TraceStageLike[])
    expect(steps).toHaveLength(1)
    expect(steps[0]!.step).toBe('rewrite')
  })

  it('空数组返回空数组', () => {
    expect(traceStagesToThinkingSteps([])).toEqual([])
  })
})
