/**
 * PlanContext —— 五步责任链内部上下文
 * PlanContext
 */
import type { ExecutionMode } from '@/common/enums/execution-mode'
import type { ChatQueryMode } from '@/common/enums/chat-query-mode'

export interface PlanContext {
  question: string
  sessionId: string
  rewritten: string
  subQuestions: string[]
  mode: ExecutionMode
  // 用户侧问答模式（透传自 DTO）
  chatMode?: ChatQueryMode
  // 当前文档问答模式下用户选中的文档 id
  selectedDocumentId?: string
}
