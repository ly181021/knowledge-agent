/**
 * ReactAgentExecutor —— ReAct Agent：AI SDK 原生多步循环（streamText + tools + maxSteps），
 * 工具 = 知识库检索（RagService）+ 联网搜索（Tavily），三层成本熔断。
 * 自托管流：prepare 只产出上下文，stream 委托 ReactAgentService 组装带工具的 streamText。
 */
import { Injectable, Inject, Logger } from '@nestjs/common'
import type { ChatMemory } from '@/modules/chatagent/memory/chat-memory'
import type { ConversationExecutionPlan, ExecutorContext } from '../execution-plan'
import { ReactAgentService } from '../react-agent/react-agent.service'
import type { AnyStreamTextResult, ReactStreamDeps } from './registry'

@Injectable()
export class ReactAgentExecutor {
  private readonly logger = new Logger(ReactAgentExecutor.name)

  constructor(
    @Inject('CHAT_MEMORY') private memory: ChatMemory,
    private reactAgentService: ReactAgentService,
  ) {}

  async prepare(plan: ConversationExecutionPlan): Promise<ExecutorContext> {
    const history = await this.memory.load(plan.sessionId)

    this.logger.log(`react-agent prepare (open-chat mode): history=${history.length}`)

    return {
      history,
      userContent: plan.rewritten,
      // 开放式提问：鼓励模型自主决策是否检索知识库/联网（带上 tools 后不能写死无需引用知识库的指令）
      systemSuffix: '\n当前为开放式提问模式。你可以自主决定是否检索企业知识库或联网搜索来辅助回答。',
      tools: undefined, // 实际 tools 在 ReactAgentService.stream 里组装（不走 ctx.tools）
      citations: [],
    }
  }

  /** 自托管带 tools 的 streamText（chat.service 检测到本方法存在即分流走 ReAct） */
  async stream(ctx: ExecutorContext, deps: ReactStreamDeps): Promise<AnyStreamTextResult> {
    return this.reactAgentService.stream(ctx, deps)
  }
}
