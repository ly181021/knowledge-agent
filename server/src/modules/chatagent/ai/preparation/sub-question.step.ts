/**
 * SubQuestionStep —— 五步责任链第 2 步：子问题拆分
 * 跳过条件：问题不含 和/与/以及/、/或 等连词（无需拆分，max-sub-questions=4）
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import type { PlanContext } from './plan-context'
import { NoopProgressEmitter, type ProgressEmitter } from '../progress-emitter'

@Injectable()
export class SubQuestionStep {
  private readonly logger = new Logger(SubQuestionStep.name)

  constructor(private llm: LlmService) {}

  async execute(
    ctx: PlanContext,
    emitter: ProgressEmitter = new NoopProgressEmitter(),
  ): Promise<void> {
    const q = ctx.rewritten || ctx.question

    // 跳过条件：检查原始问题是否含连词（改写后连词可能被去掉）
    const hasConjunction = /[和与以及、]|或.*或/.test(ctx.question)
    if (!hasConjunction) {
      ctx.subQuestions = [q]
      this.logger.debug(`subQuestion skipped (no conjunction): ${ctx.question.slice(0, 40)}`)
      this.emitSafe(emitter, 'subQuestion', { questions: ctx.subQuestions, skipped: true })
      return
    }

    try {
      // 给 LLM 的是改写后的文本（检索友好），但判断用原始问题
      const prompt = renderPrompt('sub-question', { question: q })
      const { text } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是问题拆分助手，只返回JSON数组，不要解释。',
        prompt,
      })

      // 尝试解析 JSON 数组
      const trimmed = text.trim()
      const match = trimmed.match(/\[.*\]/s)
      if (match) {
        const parsed = JSON.parse(match[0]) as string[]
        ctx.subQuestions = parsed.slice(0, 4)
        this.logger.log(`subQuestion: split into ${ctx.subQuestions.length} sub-questions`)
        this.emitSafe(emitter, 'subQuestion', { questions: ctx.subQuestions, skipped: false })
      } else {
        // LLM 返回了文本但未匹配到 JSON 数组 → 实际未拆分成功，回退单元素
        ctx.subQuestions = [q]
        this.emitSafe(emitter, 'subQuestion', { questions: ctx.subQuestions, skipped: true })
      }
    } catch (e) {
      this.logger.warn(`subQuestion failed, using single: ${e instanceof Error ? e.message : String(e)}`)
      ctx.subQuestions = [q]
      this.emitSafe(emitter, 'subQuestion', { questions: ctx.subQuestions, skipped: true, error: true })
    }
  }

  /** emit 包装：任何异常都不应中断主链路 */
  private emitSafe(emitter: ProgressEmitter, step: 'subQuestion', payload: Record<string, unknown>): void {
    try {
      emitter.emit({ step, ts: Date.now(), payload })
    } catch (e) {
      this.logger.warn(`progress emit failed step=${step}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
