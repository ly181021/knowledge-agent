import { ConfigService } from '@nestjs/config'
import { Kafka } from 'kafkajs'
import { KafkaService } from './kafka.provider'

interface MockConsumer {
  events: { CRASH: string; DISCONNECT: string }
  connect: jest.Mock
  subscribe: jest.Mock
  run: jest.Mock
  disconnect: jest.Mock
  commitOffsets: jest.Mock
  on: jest.Mock
}

jest.mock('kafkajs', () => {
  const state = { failNextConnect: 0 }
  const makeConsumer = (): MockConsumer => {
    const willFail = state.failNextConnect > 0
    if (willFail) state.failNextConnect -= 1
    return {
      events: { CRASH: 'CRASH', DISCONNECT: 'DISCONNECT' },
      connect: jest.fn(() => (willFail ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve())),
      subscribe: jest.fn(() => Promise.resolve()),
      run: jest.fn(() => Promise.resolve()),
      disconnect: jest.fn(() => Promise.resolve()),
      commitOffsets: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
    }
  }
  return {
    __state: state,
    Kafka: jest.fn().mockImplementation(() => ({
      producer: jest.fn(() => ({
        on: jest.fn(),
        connect: jest.fn(() => Promise.resolve()),
        send: jest.fn(() => Promise.resolve()),
        disconnect: jest.fn(() => Promise.resolve()),
      })),
      admin: jest.fn(() => ({
        connect: jest.fn(() => Promise.resolve()),
        listTopics: jest.fn(() => Promise.resolve([])),
        disconnect: jest.fn(() => Promise.resolve()),
      })),
      consumer: jest.fn(() => makeConsumer()),
    })),
  }
})

const kafkaCtor = Kafka as unknown as jest.Mock
const mockState = () =>
  (jest.requireMock('kafkajs') as unknown as { __state: { failNextConnect: number } }).__state

const createdConsumers = (): MockConsumer[] =>
  kafkaCtor.mock.results[0].value.consumer.mock.results.map(
    (r: { value: unknown }) => r.value as unknown as MockConsumer,
  )

const makeService = (): KafkaService => {
  const config = {
    get: jest.fn((key: string, fallback?: string) => (key === 'KAFKA_BROKERS' ? 'localhost:29092' : fallback)),
  }
  const svc = new KafkaService(config as unknown as ConfigService)
  // 加速测试：sleep 直接 resolve（指数退避的数值由 spy 断言）
  jest.spyOn(svc as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue()
  return svc
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const until = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !pred(); i++) await tick()
  expect(pred()).toBe(true)
}

describe('KafkaService.consume', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockState().failNextConnect = 0
  })

  it('注册失败后自动重试，成功后以 fromBeginning=true 订阅', async () => {
    mockState().failNextConnect = 1
    const svc = makeService()
    void svc.consume('doc-topic', 'g1', jest.fn().mockResolvedValue(undefined))

    const c1 = createdConsumers()[0]
    await until(() => createdConsumers().length >= 2)

    expect(c1.connect).toHaveBeenCalledTimes(1)
    expect(c1.subscribe).not.toHaveBeenCalled()
    const c2 = createdConsumers()[1]
    expect(c2.subscribe).toHaveBeenCalledWith({ topic: 'doc-topic', fromBeginning: true })
    expect(c2.run).toHaveBeenCalled()
  })

  it('连续失败按指数退避持续重试（1s→2s→4s）', async () => {
    mockState().failNextConnect = 3
    const svc = makeService()
    void svc.consume('doc-topic', 'g1', jest.fn().mockResolvedValue(undefined))

    await until(() => createdConsumers().length >= 4)
    const sleepSpy = (svc as unknown as { sleep: jest.Mock }).sleep
    expect(sleepSpy.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000])
  })

  it('运行期 CRASH 后自动重建消费者重连', async () => {
    const svc = makeService()
    void svc.consume('doc-topic', 'g1', jest.fn().mockResolvedValue(undefined))

    await until(() => (createdConsumers()[0]?.on.mock.calls.length ?? 0) >= 2)
    const c1 = createdConsumers()[0]
    const crashCall = c1.on.mock.calls.find((args: unknown[]) => args[0] === 'CRASH')
    expect(crashCall).toBeDefined()
    ;(crashCall[1] as () => void)() // 模拟运行期崩溃

    await until(() => createdConsumers().length >= 2)
    expect(c1.disconnect).toHaveBeenCalled()
    expect(createdConsumers()[1].connect).toHaveBeenCalled()
  })

  it('eachMessage 成功后手动 commit offset+1；handler 抛错不 commit', async () => {
    const svc = makeService()
    const handler = jest.fn().mockResolvedValue(undefined)
    void svc.consume('doc-topic', 'g1', handler)

    await until(() => (createdConsumers()[0]?.run.mock.calls.length ?? 0) >= 1)
    const c = createdConsumers()[0]
    const eachMessage = c.run.mock.calls[0][0].eachMessage as (ctx: {
      topic: string
      partition: number
      message: { offset: string; value: Buffer }
      heartbeat: () => Promise<void>
    }) => Promise<void>

    // 成功路径：commit message.offset + 1（字符串化，见 offsetManager 覆盖语义注释）
    await eachMessage({
      topic: 'doc-topic',
      partition: 0,
      message: { offset: '5', value: Buffer.from('{}') },
      heartbeat: jest.fn(),
    })
    expect(handler).toHaveBeenCalledWith('{}')
    expect(c.commitOffsets).toHaveBeenCalledWith([{ topic: 'doc-topic', partition: 0, offset: '6' }])

    // 失败路径：handler 抛错 → 不 commit 且向上抛（触发 CRASH → 外层重连重投）
    handler.mockRejectedValueOnce(new Error('boom'))
    await expect(
      eachMessage({
        topic: 'doc-topic',
        partition: 0,
        message: { offset: '6', value: Buffer.from('{}') },
        heartbeat: jest.fn(),
      }),
    ).rejects.toThrow('boom')
    expect(c.commitOffsets).toHaveBeenCalledTimes(1)
  })
})
