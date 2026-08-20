/**
 * PreparationOrchestrator —— 五步责任链
 * 五步责任链：rewrite → subQuestion → scopeShrink → clarification → route
 * - rewrite：LLM 改写口语化问题为检索关键词（有跳过条件）
 * - subQuestion：LLM 拆分多意图问题为子问题（有跳过条件）
 * - scopeShrink：当前空操作（无 Scope/Topic 数据）
 * - clarification：规则判断（问题太短 → CLARIFICATION）
 * - route：按 chatMode 分流（OPEN_CHAT → REACT_AGENT，其余 → RETRIEVAL）
 * chatMode（用户侧问答模式）分流规则：
 * - OPEN_CHAT      → REACT_AGENT（开放式提问，不走知识库）
 * - DOCUMENT       → RETRIEVAL（当前文档问答，检索范围限定单文档，由执行器读取 selectedDocumentId）
 * - AUTO_DOCUMENT  → RETRIEVAL（自动知识问答，全库检索）
 * - 未传（旧客户端兼容）→ RETRIEVAL
 * 注意：clarification 步骤对问题过短的判定仍保留，但其结果会被 chatMode 覆盖（用户已明确选了模式）。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'
import type { ConversationExecutionPlan } from '../execution-plan'
import type { PlanContext } from './plan-context'
import { RewriteStep } from './rewrite.step'
import { SubQuestionStep } from './sub-question.step'
import { ScopeShrinkStep } from './scope-shrink.step'
import { NoopProgressEmitter, type ProgressEmitter, type PrepareStep } from '../progress-emitter'

/** prepare 的第四参：用户侧问答模式上下文 */
export interface PrepareOptions {
  chatMode?: ChatQueryMode
  selectedDocumentId?: string
}

@Injectable()
export class PreparationOrchestrator {
  private readonly logger = new Logger(PreparationOrchestrator.name)

  constructor(
    private rewrite: RewriteStep,
    private subQuestion: SubQuestionStep,
    private scopeShrink: ScopeShrinkStep,
  ) {}

  async prepare(
    question: string,
    sessionId: string,
    emitter: ProgressEmitter = new NoopProgressEmitter(),
    options?: PrepareOptions,
  ): Promise<ConversationExecutionPlan> {
    // 初始化上下文（chatMode / selectedDocumentId 透传自 DTO）
    const ctx: PlanContext = {
      question,
      sessionId,
      rewritten: question,
      subQuestions: [question],
      mode: ExecutionMode.RETRIEVAL,
      chatMode: options?.chatMode,
      selectedDocumentId: options?.selectedDocumentId,
    }

    // 1. 改写（step 内部 emit 详见 payload：from/to/skipped）
    await this.rewrite.execute(ctx, emitter)

    // 2. 子问题拆分（step 内部 emit 详见 payload：questions/skipped）
    await this.subQuestion.execute(ctx, emitter)

    // 3. 知识域收缩（step 内部自己 emit skipped）
    await this.scopeShrink.execute(ctx, emitter)

    // 4. 歧义检测（规则判断：问题太短 → CLARIFICATION）
    //    仅在未显式指定 chatMode 时生效（用户已选模式时尊重用户选择）
    const chatMode = options?.chatMode
    if (!chatMode) {
      const trimmed = question.trim()
      if (trimmed.length < 5 || /^[\s\p{P}]+$/u.test(trimmed)) {
        ctx.mode = ExecutionMode.CLARIFICATION
        this.emitSafe(emitter, 'clarification', { mode: ExecutionMode.CLARIFICATION, reason: 'too_short' })
      }
    }

    // 5. 路由判定：按 chatMode 分流覆盖 ctx.mode
    //    OPEN_CHAT → REACT_AGENT；DOCUMENT/AUTO_DOCUMENT → RETRIEVAL；未传 → 保持第 4 步结果
    if (chatMode === ChatQueryMode.OPEN_CHAT) {
      ctx.mode = ExecutionMode.REACT_AGENT
    } else if (chatMode === ChatQueryMode.DOCUMENT || chatMode === ChatQueryMode.AUTO_DOCUMENT) {
      ctx.mode = ExecutionMode.RETRIEVAL
    }
    this.emitSafe(emitter, 'route', { mode: ctx.mode })

    const plan: ConversationExecutionPlan = {
      sessionId: ctx.sessionId,
      question: ctx.question,
      rewritten: ctx.rewritten,
      subQuestions: ctx.subQuestions,
      mode: ctx.mode,
      chatMode: ctx.chatMode,
      selectedDocumentId: ctx.selectedDocumentId,
    }

    this.logger.log(
      `prepare: sessionId=${sessionId} mode=${ctx.mode} chatMode=${chatMode ?? '-'} ` +
      `rewrite="${ctx.question.slice(0, 20)}"→"${ctx.rewritten.slice(0, 20)}" ` +
      `subQ=${ctx.subQuestions.length}`,
    )
    return plan
  }

  /** emit 包装：任何异常都不应中断主链路 */
  private emitSafe(emitter: ProgressEmitter, step: PrepareStep, payload: Record<string, unknown>): void {
    try {
      emitter.emit({ step, ts: Date.now(), payload })
    } catch (e) {
      this.logger.warn(`progress emit failed step=${step}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
