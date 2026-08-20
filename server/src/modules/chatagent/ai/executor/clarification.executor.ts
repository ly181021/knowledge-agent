/**
 * ClarificationExecutor —— 歧义澄清
 * 不调模型检索，直接返回澄清提示
 */
import { Injectable } from '@nestjs/common'
import type { ConversationExecutionPlan, ExecutorContext } from '../execution-plan'

@Injectable()
export class ClarificationExecutor {
  async prepare(plan: ConversationExecutionPlan): Promise<ExecutorContext> {
    return {
      history: [],
      userContent: plan.question,
      systemSuffix: '用户的问题不够清晰，请引导用户补充更多细节，比如具体想了解哪个方面。',
      tools: undefined,
      citations: [],
    }
  }
}
