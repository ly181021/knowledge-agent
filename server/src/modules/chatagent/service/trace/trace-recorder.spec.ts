import { TraceRecorder } from './trace-recorder'
import type { PrismaService } from '@/prisma/prisma.service'
import type { ProgressEvent } from '@/modules/chatagent/ai/progress-emitter'

describe('TraceRecorder.recordStage', () => {
  it('正常事件：写 TraceStage，state=done，payload 存 output', async () => {
    const created = jest.fn().mockResolvedValue({})
    const prisma = { traceStage: { create: created } } as unknown as PrismaService
    const recorder = new TraceRecorder(prisma)
    const event: ProgressEvent = {
      step: 'rewrite',
      ts: 1000,
      payload: { from: 'a', to: 'b', skipped: false, durationMs: 50 },
    }
    recorder.recordStage('sess-1', 'ex-1', event)
    // fire-and-forget：create 被调用即可
    expect(created).toHaveBeenCalledTimes(1)
    const arg = created.mock.calls[0][0].data
    expect(arg.sessionId).toBe('sess-1')
    expect(arg.exchangeId).toBe('ex-1')
    expect(arg.stage).toBe('rewrite')
    expect(arg.state).toBe('done')
    expect(arg.output).toEqual({ from: 'a', to: 'b', skipped: false, durationMs: 50 })
    expect(arg.durationMs).toBe(50)
    expect(arg.endedAt).toBeInstanceOf(Date)
  })

  it('skipped 事件：state=skipped', () => {
    const created = jest.fn().mockResolvedValue({})
    const prisma = { traceStage: { create: created } } as unknown as PrismaService
    const recorder = new TraceRecorder(prisma)
    const event: ProgressEvent = { step: 'scopeShrink', ts: 1, payload: { skipped: true } }
    recorder.recordStage('sess-1', 'ex-1', event)
    expect(created.mock.calls[0][0].data.state).toBe('skipped')
  })

  it('error 事件：state=error（优先于 skipped）', () => {
    const created = jest.fn().mockResolvedValue({})
    const prisma = { traceStage: { create: created } } as unknown as PrismaService
    const recorder = new TraceRecorder(prisma)
    const event: ProgressEvent = { step: 'rewrite', ts: 1, payload: { skipped: true, error: true } }
    recorder.recordStage('sess-1', 'ex-1', event)
    expect(created.mock.calls[0][0].data.state).toBe('error')
  })

  it('DB 写失败时不抛错（fire-and-forget）', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'))
    const warn = jest.fn()
    const prisma = { traceStage: { create } } as unknown as PrismaService
    const recorder = new TraceRecorder(prisma)
    ;(recorder as unknown as { logger: { warn: jest.Mock; log: jest.Mock; debug: jest.Mock } }).logger = { warn, log: jest.fn(), debug: jest.fn() }
    const event: ProgressEvent = { step: 'rewrite', ts: 1, payload: {} }
    expect(() => recorder.recordStage('sess-1', 'ex-1', event)).not.toThrow()
    // 等微任务跑完 catch
    await new Promise((r) => setTimeout(r, 10))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recordStage failed'))
  })

  it('exchangeId 为 null 时也能写', () => {
    const created = jest.fn().mockResolvedValue({})
    const prisma = { traceStage: { create: created } } as unknown as PrismaService
    const recorder = new TraceRecorder(prisma)
    recorder.recordStage('sess-1', null, { step: 'route', ts: 1, payload: { mode: 'RETRIEVAL' } })
    expect(created.mock.calls[0][0].data.exchangeId).toBeNull()
  })
})
