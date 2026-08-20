/**
 * RetrievalExecutor —— = RagChatExecutor
 * RAG 知识问答：加载历史记忆 + RAG 双通道检索 + 组装证据/引用
 * 透传 subQuestions 给 RagService 做多子问题并行检索
 */
import { Injectable, Inject, Logger } from '@nestjs/common'
import { RagService } from '@/modules/chatagent/rag/rag.service'
import type { ChatMemory } from '@/modules/chatagent/memory/chat-memory'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'
import type { ConversationExecutionPlan, ExecutorContext } from '../execution-plan'
import { NoopProgressEmitter, type ProgressEmitter, type PrepareStep } from '../progress-emitter'

@Injectable()
export class RetrievalExecutor {
  private readonly logger = new Logger(RetrievalExecutor.name)

  constructor(
    private rag: RagService,
    @Inject('CHAT_MEMORY') private memory: ChatMemory,
  ) {}

  async prepare(
    plan: ConversationExecutionPlan,
    emitter: ProgressEmitter = new NoopProgressEmitter(),
  ): Promise<ExecutorContext> {
    // 1. 加载历史记忆（摘要 + 滑窗）
    const history = await this.memory.load(plan.sessionId)

    // 2. RAG 检索（双通道 + RRF，支持子问题并行）
    //    DOCUMENT 模式：限定在用户选中的单文档内检索
    const documentIds =
      plan.chatMode === ChatQueryMode.DOCUMENT && plan.selectedDocumentId ? [plan.selectedDocumentId] : undefined
    const { evidence, citations, channels, results } = await this.rag.retrieve(
      plan.rewritten,
      plan.subQuestions,
      { documentIds },
    )

    this.logger.log(
      `retrieval prepare: history=${history.length} citations=${citations.length}` +
        (documentIds ? ` docScope=${documentIds[0]}` : ''),
    )

    // 3. emit retrieval 事件：通道召回 + 融合结果 + topK
    this.emitSafe(emitter, 'retrieval', {
      channels: channels.map((c) => ({
        name: c.channel,
        recalled: c.recalled,
        accepted: c.accepted,
        durationMs: c.durationMs,
      })),
      fusedCount: results.length,
      topK: citations.length,
    })

    // 4. 组装 systemSuffix
    const systemSuffix = evidence
      ? `\n请基于以下检索到的知识回答用户问题，并在回答中标注引用编号（如[1]）。如果检索结果不足以回答，请如实说明。\n\n${evidence}`
      : '\n未检索到相关知识。请基于自身能力回答，并告知用户可能不准确。'

    return {
      history,
      userContent: plan.rewritten,
      systemSuffix,
      tools: undefined,
      citations,
      ragChannels: channels,
      ragResults: results,
    }
  }

  /**
   * 安全发射 progress 事件：发射失败不得中断检索/回答主流程。
   */
  private emitSafe(emitter: ProgressEmitter, step: PrepareStep, payload: Record<string, unknown>): void {
    try {
      emitter.emit({ step, ts: Date.now(), payload })
    } catch (e) {
      this.logger.warn(
        `progress emit failed step=${step}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
