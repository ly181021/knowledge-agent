/**
 * ReactAgentService 单测
 * 用 jest.mock('ai') 拦截 streamText，捕获 options 断言（不依赖真模型决策）：
 * 1. 工具注册：knowledgeSearch + webSearch + maxSteps=8
 * 2. 熔断触发：onStepFinish 累计超 MAX_TOOL_CALLS 抛错
 * 3. usage 累计：各步 usage 求和传给 onFinish（v4 onFinish usage 只含最后一步）
 * 4. executor 转发：ReactAgentExecutor.stream 委托 ReactAgentService.stream + systemSuffix 语义
 */
jest.mock('ai', () => ({ streamText: jest.fn() }))

import { streamText } from 'ai'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ReactAgentService } from './react-agent.service'
import { ReactAgentExecutor } from '../executor/react-agent.executor'
import { MAX_STEPS, MAX_TOOL_CALLS } from './react-agent.config'

const streamTextMock = streamText as jest.Mock

/** 最小 deps（chat.service 注入的依赖全集） */
function makeDeps() {
  return {
    llm: { getChatModel: jest.fn(() => ({})), getModelName: jest.fn(() => 'test-model') },
    memory: { append: jest.fn(), load: jest.fn() },
    trace: { recordTool: jest.fn(), recordModelUsage: jest.fn(), finishExchange: jest.fn() },
    data: { append: jest.fn() },
    emitter: { emit: jest.fn() },
    exchangeId: 'ex-1',
    t0: 0,
    onFinish: jest.fn(),
  }
}

const ctx = {
  history: [],
  userContent: '测试问题',
  systemSuffix: '',
  citations: [],
}

function makeService(tavilyKey?: string) {
  const rag = { retrieve: jest.fn().mockResolvedValue({ results: [] }) }
  // TAVILY_KEY 有值时返回该值，其余变量返回 undefined（模拟未配置）
  const config = { get: jest.fn((k: string) => (k === 'TAVILY_KEY' ? tavilyKey : undefined)) }
  const service = new ReactAgentService(rag as never, config as never)
  return { service, rag, config }
}

describe('ReactAgentService', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
    streamTextMock.mockReturnValue({ toDataStreamResponse: jest.fn() })
  })

  it('工具注册（TAVILY_KEY 已配置）：streamText 收到 knowledgeSearch + webSearch + maxSteps=8', async () => {
    const { service } = makeService('sk-test')
    await service.stream(ctx as never, makeDeps() as never)

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    const opts = streamTextMock.mock.calls[0][0]
    expect(opts.maxSteps).toBe(MAX_STEPS)
    expect(opts.tools).toHaveProperty('knowledgeSearch')
    expect(opts.tools).toHaveProperty('webSearch')
    // v4 工具定义：parameters 是 zod schema（可校验）
    expect(opts.tools.knowledgeSearch.parameters).toBeDefined()
    expect(opts.tools.webSearch.parameters).toBeDefined()
  })

  it('工具注册（TAVILY_KEY 未配置）：只注册 knowledgeSearch，不注册 webSearch（避免模型空转调不可用工具）', async () => {
    const { service } = makeService()
    await service.stream(ctx as never, makeDeps() as never)

    const opts = streamTextMock.mock.calls[0][0]
    expect(opts.tools).toHaveProperty('knowledgeSearch')
    expect(opts.tools).not.toHaveProperty('webSearch')
  })

  it('熔断触发：onStepFinish 累计超 MAX_TOOL_CALLS 抛错中断', async () => {
    const { service } = makeService()
    const deps = makeDeps()
    await service.stream(ctx as never, deps as never)
    const opts = streamTextMock.mock.calls[0][0]

    // 前 MAX_TOOL_CALLS 次正常（计数 = MAX_TOOL_CALLS 不抛）
    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      await opts.onStepFinish({
        toolCalls: [{ toolName: 'knowledgeSearch', args: { query: 'x' } }],
        usage: { totalTokens: 1 },
      })
    }
    // 第 MAX_TOOL_CALLS+1 次 → 超限抛错
    await expect(
      opts.onStepFinish({
        toolCalls: [{ toolName: 'webSearch', args: { query: 'x' } }],
        usage: { totalTokens: 1 },
      }),
    ).rejects.toThrow(`工具调用超限（单轮上限 ${MAX_TOOL_CALLS} 次），已熔断`)
  })

  it('usage 累计：onFinish 收到各步 usage 之和（v4 onFinish usage 只含最后一步）', async () => {
    const { service } = makeService()
    const deps = makeDeps()
    await service.stream(ctx as never, deps as never)
    const opts = streamTextMock.mock.calls[0][0]

    await opts.onStepFinish({ toolCalls: [], usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } })
    await opts.onStepFinish({ toolCalls: [], usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } })

    await opts.onFinish({ text: '回答内容', toolCalls: [] })

    expect(deps.onFinish).toHaveBeenCalledWith(
      '回答内容',
      { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
      [],
    )
  })

  it('onStepFinish 会推 tool-status 帧 + 写工具 trace（fire-and-forget）', async () => {
    const { service } = makeService()
    const deps = makeDeps()
    await service.stream(ctx as never, deps as never)
    const opts = streamTextMock.mock.calls[0][0]

    await opts.onStepFinish({
      toolCalls: [{ toolName: 'knowledgeSearch', args: { query: '报销' } }],
      usage: { totalTokens: 1 },
    })

    expect(deps.data.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool-status' }),
    )
    expect(deps.trace.recordTool).toHaveBeenCalledWith(
      'ex-1',
      expect.objectContaining({ toolName: 'knowledgeSearch' }),
    )
  })
})

describe('ReactAgentExecutor（自托管流转发）', () => {
  it('prepare 的 systemSuffix 鼓励自主决策（不带"无需引用知识库"）', async () => {
    const mockService = { stream: jest.fn() }
    const executor = new ReactAgentExecutor(
      { load: jest.fn().mockResolvedValue([]) } as never,
      mockService as never,
    )

    const plan = {
      sessionId: 's1',
      question: 'q',
      rewritten: 'q',
      subQuestions: ['q'],
      mode: ExecutionMode.REACT_AGENT,
    }
    const ctx = await executor.prepare(plan as never)

    expect(ctx.systemSuffix).toContain('自主决定')
    expect(ctx.systemSuffix).not.toContain('无需引用')
  })

  it('stream 委托 ReactAgentService.stream', async () => {
    const mockService = { stream: jest.fn().mockResolvedValue({}) }
    const executor = new ReactAgentExecutor(
      { load: jest.fn().mockResolvedValue([]) } as never,
      mockService as never,
    )

    await executor.stream({} as never, {} as never)

    expect(mockService.stream).toHaveBeenCalledTimes(1)
  })
})
