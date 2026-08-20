import { NoopProgressEmitter, type ProgressEmitter } from './progress-emitter'

describe('ProgressEmitter', () => {
  it('NoopProgressEmitter.emit 不抛错（安全 no-op）', () => {
    const emitter: ProgressEmitter = new NoopProgressEmitter()
    expect(() =>
      emitter.emit({ step: 'rewrite', ts: Date.now(), payload: { from: 'a', to: 'b' } }),
    ).not.toThrow()
  })

  it('emit 接受所有 6 个 step 名', () => {
    const calls: string[] = []
    const emitter: ProgressEmitter = {
      emit: (e) => calls.push(e.step),
    }
    const steps = ['rewrite', 'subQuestion', 'scopeShrink', 'clarification', 'route', 'retrieval'] as const
    for (const step of steps) {
      emitter.emit({ step, ts: Date.now(), payload: {} })
    }
    expect(calls).toEqual([...steps])
  })
})
