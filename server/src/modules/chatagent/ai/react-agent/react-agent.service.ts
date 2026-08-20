/**
 * ReactAgentService —— ReAct 自托管流主体
 * 组装 tools + maxSteps + onStepFinish/onFinish，调用 streamText 返回 StreamTextResult
 * - 收尾单份：onFinish 调 deps.onFinish（chat.service 注入的回调），不复制收尾
 * - 熔断：onStepFinish 计数超 MAX_TOOL_CALLS 抛错中断流，onFinish 不触发，由 chat.service 外层 try/catch 兜底收尾
 * - 累计：onFinish 的 usage 与 toolCalls 只含最后一步，这里自行累计全量（memory 落库需要完整工具调用记录）
 */
import { Injectable, Logger } from '@nestjs/common'
import { streamText, type JSONValue, type LanguageModelUsage, type StreamTextResult, type ToolCall } from 'ai'
// ConfigService 必须值导入：emitDecoratorMetadata 反射需要它在 design:paramtypes 里（type-only 导入会被擦除 → DI 解析失败）
import { ConfigService } from '@nestjs/config'
import { RagService } from '@/modules/chatagent/rag/rag.service'
import type { ExecutorContext } from '../execution-plan'
import type { ReactStreamDeps } from '../executor/registry'
import { MAX_STEPS, MAX_TOOL_CALLS } from './react-agent.config'
import { createKnowledgeTools } from './tools/knowledge.tool'
import { createTavilyTools } from './tools/tavily.tool'

@Injectable()
export class ReactAgentService {
  private readonly logger = new Logger(ReactAgentService.name)

  constructor(
    private rag: RagService,
    private config: ConfigService,
  ) {}

  async stream(ctx: ExecutorContext, deps: ReactStreamDeps): Promise<StreamTextResult<never, never>> {
    // TAVILY_KEY 未配置时不注册 webSearch：工具不可用就不给模型，否则模型会调用一个必然失败的工具
    const hasTavily = Boolean(this.config.get<string>('TAVILY_KEY'))
    if (!hasTavily) this.logger.warn('TAVILY_KEY 未配置，webSearch 工具未注册（OPEN_CHAT 无法联网搜索，请在 server/.env 配置）')
    const tools = {
      ...createKnowledgeTools(this.rag),
      ...(hasTavily ? createTavilyTools(this.config) : {}),
    }
    let toolCallCount = 0
    const stepUsages: LanguageModelUsage[] = []
    const allToolCalls: ToolCall<string, unknown>[] = []

    const result = streamText({
      model: deps.llm.getChatModel(),
      system: `你是企业智能助手。${ctx.systemSuffix ?? ''}`,
      messages: [
        ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: ctx.userContent },
      ],
      tools,
      maxSteps: MAX_STEPS,
      onStepFinish: async ({ toolCalls, usage }) => {
        // 条件注册后 tools 类型推断含 undefined（webSearch 可选），先过滤窄化
        const calls = toolCalls.filter((tc): tc is NonNullable<typeof tc> => tc !== undefined)
        toolCallCount += calls.length
        stepUsages.push(usage)
        allToolCalls.push(...calls)

        // 推工具状态帧给前端（fire-and-forget，data.append 是同步的）
        for (const tc of calls) {
          deps.data.append({
            type: 'tool-status',
            value: { toolName: tc.toolName, status: 'running', ts: Date.now() },
          } as unknown as JSONValue)
        }

        // 写工具 trace（fire-and-forget，不 await 避免阻塞流）
        for (const tc of calls) deps.trace.recordTool(deps.exchangeId, tc)

        // 熔断：超限抛错中断流（外层 chat.service try/catch 兜底收尾）
        if (toolCallCount > MAX_TOOL_CALLS) {
          throw new Error(`工具调用超限（单轮上限 ${MAX_TOOL_CALLS} 次），已熔断`)
        }
      },
      onFinish: async ({ text }) => {
        // onFinish 的 usage 只含最后一步，用累计值 + 全量 toolCalls 传给收尾回调
        const totalUsage = stepUsages.reduce<LanguageModelUsage>(
          (acc, u) => ({
            promptTokens: (acc.promptTokens ?? 0) + (u.promptTokens ?? 0),
            completionTokens: (acc.completionTokens ?? 0) + (u.completionTokens ?? 0),
            totalTokens: (acc.totalTokens ?? 0) + (u.totalTokens ?? 0),
          }),
          { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        )
        await deps.onFinish(text, totalUsage, allToolCalls)
      },
    })
    return result
  }
}
