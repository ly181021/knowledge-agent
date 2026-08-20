/**
 * RewriteStep —— 五步责任链第 1 步：查询改写
 * 跳过条件：问题 > 15 字且不含 ？ 时跳过（已经很清晰）
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import type { PlanContext } from './plan-context'
import { NoopProgressEmitter, type ProgressEmitter } from '../progress-emitter'

@Injectable()
export class RewriteStep {
  private readonly logger = new Logger(RewriteStep.name)

  constructor(private llm: LlmService) {}

  async execute(
    ctx: PlanContext,
    emitter: ProgressEmitter = new NoopProgressEmitter(),
  ): Promise<void> {
    const q = ctx.question.trim()

    // 跳过条件：问题较长且不含问号，认为已经足够清晰
    if (q.length > 15 && !q.includes('？') && !q.includes('?')) {
      ctx.rewritten = q
      this.logger.debug(`rewrite skipped (clear question): ${q.slice(0, 40)}`)
      this.emitSafe(emitter, 'rewrite', { from: ctx.question, to: ctx.rewritten, skipped: true })
      return
    }

    try {
      const prompt = renderPrompt('query-rewrite', { question: ctx.question })
      const { text } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是查询改写助手，只返回改写后的问题，不要解释。',
        prompt,
      })
      ctx.rewritten = text.trim() || ctx.question
      this.logger.log(`rewrite: "${ctx.question.slice(0, 40)}" → "${ctx.rewritten.slice(0, 40)}"`)
      this.emitSafe(emitter, 'rewrite', { from: ctx.question, to: ctx.rewritten, skipped: false })
    } catch (e) {
      this.logger.warn(`rewrite failed, using original: ${e instanceof Error ? e.message : String(e)}`)
      ctx.rewritten = ctx.question
      this.emitSafe(emitter, 'rewrite', { from: ctx.question, to: ctx.question, skipped: true, error: true })
    }
  }

  /** emit 包装：任何异常都不应中断主链路 */
  private emitSafe(emitter: ProgressEmitter, step: 'rewrite', payload: Record<string, unknown>): void {
    try {
      emitter.emit({ step, ts: Date.now(), payload })
    } catch (e) {
      this.logger.warn(`progress emit failed step=${step}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
