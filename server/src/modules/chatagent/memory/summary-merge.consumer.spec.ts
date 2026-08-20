/**
 * SummaryMergeConsumer 回归单测
 * 覆盖：overflow 空跳过 / 无摘要 create v1 / 有摘要 update v+1 / 1400 截断 / 失败吞异常（不重投语义）
 * 说明：kafka 仅在 onModuleInit 使用，merge 不触碰，测试直接调 merge（mock kafka 为空对象）
 */
import { SummaryMergeConsumer } from './summary-merge.consumer'
import { generateText } from 'ai'

jest.mock('ai', () => ({
  generateText: jest.fn(),
}))

// renderPrompt 读 src 下 .md 模板的路径计算（__dirname 上 5 层）在 ts-jest 环境指向错误位置，mock 掉
jest.mock('@/modules/chatagent/prompts/render', () => ({
  renderPrompt: jest.fn(() => 'rendered prompt'),
}))

const mockGenerateText = generateText as jest.Mock

describe('SummaryMergeConsumer', () => {
  let consumer: SummaryMergeConsumer
  let prisma: {
    message: { findMany: jest.Mock }
    memorySummary: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock }
  }

  const overflowMessage = (i: number) => ({
    id: `m${i}`,
    sessionId: 's1',
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `消息内容 ${i}`,
    tokenCount: 10,
    toolCalls: null,
    createdAt: new Date(2026, 0, 1, 0, i),
  })

  beforeEach(() => {
    prisma = {
      message: { findMany: jest.fn() },
      memorySummary: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    }
    mockGenerateText.mockReset()
    mockGenerateText.mockResolvedValue({ text: '这是 LLM 生成的摘要内容。' })
    // kafka 只用于 onModuleInit，merge 不触碰，给空对象；llm 需要 getChatModel（generateText 的参数求值）
    const mockLlm = { getChatModel: jest.fn(() => 'mock-model') }
    consumer = new SummaryMergeConsumer({} as never, prisma as never, mockLlm as never)
  })

  it('overflow 为空 → 不调 LLM、不写摘要', async () => {
    prisma.message.findMany.mockResolvedValue([])

    await consumer.merge('s1')

    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(prisma.memorySummary.create).not.toHaveBeenCalled()
    expect(prisma.memorySummary.update).not.toHaveBeenCalled()
  })

  it('无既有摘要 → create version=1 + 游标推进', async () => {
    // findMany 按 createdAt desc（最晚在前），merge 内 reverse 成正序；at(-1) = 最晚消息（i=1）
    prisma.message.findMany.mockResolvedValue([overflowMessage(1), overflowMessage(0)])
    prisma.memorySummary.findFirst.mockResolvedValue(null)

    await consumer.merge('s1')

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(prisma.memorySummary.create).toHaveBeenCalledWith({
      data: { sessionId: 's1', content: '这是 LLM 生成的摘要内容。', version: 1, lastCompressedAt: new Date(2026, 0, 1, 0, 1) },
    })
    expect(prisma.memorySummary.update).not.toHaveBeenCalled()
  })

  it('有既有摘要 → update version+1 + 游标推进', async () => {
    prisma.message.findMany.mockResolvedValue([overflowMessage(0)])
    prisma.memorySummary.findFirst.mockResolvedValue({ id: 'sum1', content: '旧摘要', version: 3, lastCompressedAt: null })

    await consumer.merge('s1')

    expect(prisma.memorySummary.update).toHaveBeenCalledWith({
      where: { id: 'sum1' },
      data: { content: '这是 LLM 生成的摘要内容。', version: { increment: 1 }, lastCompressedAt: new Date(2026, 0, 1, 0, 0) },
    })
    expect(prisma.memorySummary.create).not.toHaveBeenCalled()
  })

  it('增量游标：lastCompressedAt 存在时 findMany 只查游标之后的消息', async () => {
    prisma.message.findMany.mockResolvedValue([])
    prisma.memorySummary.findFirst.mockResolvedValue({
      id: 'sum1',
      content: '旧摘要',
      version: 3,
      lastCompressedAt: new Date(2026, 0, 1, 0, 5),
    })

    await consumer.merge('s1')

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 's1',
          createdAt: { gt: new Date(2026, 0, 1, 0, 5) },
        }),
      }),
    )
  })

  it('摘要超 1400 字符 → content 截断到 1400', async () => {
    mockGenerateText.mockResolvedValue({ text: '长'.repeat(2000) })
    prisma.message.findMany.mockResolvedValue([overflowMessage(0)])
    prisma.memorySummary.findFirst.mockResolvedValue(null)

    await consumer.merge('s1')

    const arg = prisma.memorySummary.create.mock.calls[0][0]
    expect(arg.data.content.length).toBe(1400)
  })

  it('LLM 调用失败 → 吞异常不抛出（不重投语义，与文档流水线 rethrow 区分）', async () => {
    mockGenerateText.mockRejectedValue(new Error('LLM timeout'))
    prisma.message.findMany.mockResolvedValue([overflowMessage(0)])
    prisma.memorySummary.findFirst.mockResolvedValue(null)

    await expect(consumer.merge('s1')).resolves.toBeUndefined()
    expect(prisma.memorySummary.create).not.toHaveBeenCalled()
  })
})
