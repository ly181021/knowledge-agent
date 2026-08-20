/**
 * ExecutorRegistry —— 策略注册表，按 ExecutionMode 分发到对应执行器
 */
import { Injectable } from '@nestjs/common'
import type { LanguageModelUsage, StreamData, StreamTextResult, ToolCall } from 'ai'
import { ExecutionMode } from '@/common/enums/execution-mode'
import type { LlmService } from '@/modules/infra/llm.provider'
import type { ChatMemory } from '@/modules/chatagent/memory/chat-memory'
import type { TraceRecorder } from '@/modules/chatagent/service/trace/trace-recorder'
import { ClarificationExecutor } from './clarification.executor'
import { RetrievalExecutor } from './retrieval.executor'
import { ReactAgentExecutor } from './react-agent.executor'
import type { ExecutorContext, ConversationExecutionPlan } from '../execution-plan'
import type { ProgressEmitter } from '../progress-emitter'

export { ClarificationExecutor, RetrievalExecutor, ReactAgentExecutor }

/**
 * ReactAgentExecutor.stream 的依赖（chat.service 注入）
 * 收尾逻辑单份：onFinish 回调由 chat.service 传入（ReAct 自托管流不复制收尾）
 */
export interface ReactStreamDeps {
  llm: LlmService
  memory: ChatMemory
  trace: TraceRecorder
  data: StreamData // Vercel AI SDK，推 tool-status 帧
  emitter: ProgressEmitter
  exchangeId: string
  t0: number
  onFinish: (text: string, usage: LanguageModelUsage, toolCalls?: ToolCall<string, unknown>[]) => Promise<void>
}

/** StreamTextResult/ToolCall 为双泛型，项目统一用宽松实例化（never 满足 extends 约束） */
export type AnyStreamTextResult = StreamTextResult<never, never>

/** 执行器接口 */
export interface Executor {
  prepare(plan: ConversationExecutionPlan, emitter?: ProgressEmitter): Promise<ExecutorContext>
  // ReAct 自托管带 tools 的流。其他执行器不实现此方法，走单轮路径
  stream?(ctx: ExecutorContext, deps: ReactStreamDeps): Promise<AnyStreamTextResult>
}

@Injectable()
export class ExecutorRegistry {
  constructor(
    private clarification: ClarificationExecutor,
    private retrieval: RetrievalExecutor,
    private reactAgent: ReactAgentExecutor,
  ) {}

  of(mode: ExecutionMode): Executor {
    const map: Record<ExecutionMode, Executor> = {
      [ExecutionMode.CLARIFICATION]: this.clarification,
      [ExecutionMode.RETRIEVAL]: this.retrieval,
      [ExecutionMode.REACT_AGENT]: this.reactAgent,
      [ExecutionMode.GRAPH_ONLY]: this.retrieval,        // 暂用 retrieval 兜底
      [ExecutionMode.GRAPH_THEN_EVIDENCE]: this.retrieval, // 暂用 retrieval 兜底
    }
    return map[mode] ?? this.retrieval
  }
}
