/**
 * RecommendationService —— 推荐追问生成
 * 在 ChatService 的收尾回调里调用，生成 ≤3 个推荐追问
 * - generateText 一次性返回（非流式）
 * - 模板要求返回 JSON 数组，失败容错返回 []
 * - 通过 data part（type=recommendations）追加推送前端
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { renderPrompt } from '../prompts/render'

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name)

  constructor(private llm: LlmService) {}

  /**
   * 生成 ≤3 个推荐追问
   * @param question 用户问题（传 plan.rewritten）
   * @param answer 助手回答
   * @returns { questions: 追问问题数组（最多 3 个，失败为 []）， usage: token 用量（失败为 null） }
   */
  async generate(
    question: string,
    answer: string,
  ): Promise<{ questions: string[]; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null }> {
    try {
      const prompt = renderPrompt('recommendation-user', { question, answer })
      const { text, usage } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是对话追问推荐助手，只返回 JSON 数组，不要解释。',
        prompt,
      })
      // 容错：LLM 偶尔把 JSON 包在 json 代码块里，先剥
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) return { questions: [], usage: null }
      const questions = parsed
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, 3)
      return {
        questions,
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            }
          : null,
      }
    } catch (e) {
      this.logger.warn(
        `recommendation failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      return { questions: [], usage: null }
    }
  }
}
