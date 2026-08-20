/**
 * ConversationExecutionPlan —— 五步责任链产物
 * PreparationOrchestrator
 */
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'

export interface ConversationExecutionPlan {
  sessionId: string
  question: string // 原始问题
  rewritten: string // 改写后问题
  subQuestions: string[] // 子问题拆分
  mode: ExecutionMode // 执行器模式
  // 用户侧问答模式（三选一），透传给执行器做检索范围判定
  chatMode?: ChatQueryMode
  // 当前文档问答模式下用户选中的文档 id（仅 chatMode=DOCUMENT 时有值）
  selectedDocumentId?: string
}

/** 单通道执行统计（透传给 trace recorder） */
export interface ExecutorChannelStat {
  channel: string
  recalled: number
  accepted: number
  durationMs?: number
}

/** 单条 chunk 分数（透传给 trace recorder） */
export interface ExecutorChunkScore {
  chunkId: string
  documentId: string
  vectorScore?: number
  keywordScore?: number
  rrfScore: number
  rerankScore?: number
  accepted: boolean
  rank: number
}

/** 执行器上下文：各执行器 prepare 后返回给 streamText 用 */
export interface ExecutorContext {
  history: { role: 'user' | 'assistant' | 'system'; content: string }[]
  userContent: string
  systemSuffix: string
  tools?: unknown
  citations: { chunkId: string; documentId: string; content: string; score: number; rank: number }[]
  // RAG 详细数据供 trace 记录
  ragChannels?: ExecutorChannelStat[]
  ragResults?: ExecutorChunkScore[]
}
