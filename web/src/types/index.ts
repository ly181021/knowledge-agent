/**
 * 统一响应与分页类型 —— 与后端对齐
 */

// 统一响应封装：{ code, message, data }
export interface R<T> {
  code: number
  message: string
  data: T
}

// 分页查询入参
export interface PageQuery {
  page: number
  size: number
  keyword?: string
}

// 分页响应
export interface PageRes<T> {
  page: number
  size: number
  total: number
  items: T[]
}

// 用户角色
export type Role = 'USER' | 'ADMIN'

// 执行模式（五层执行器）
export type ExecutionMode =
  | 'CLARIFICATION'
  | 'RETRIEVAL'
  | 'REACT_AGENT'
  | 'GRAPH_ONLY'
  | 'GRAPH_THEN_EVIDENCE'

// 文档状态
export type DocumentStatus = 'PARSING' | 'INDEXING' | 'INDEXED' | 'FAILED' | 'SOFT_DELETED'

// 文档解析阶段（轻量状态机，细粒度展示解析进度）
export type ParseStage = 'UPLOADED' | 'PARSING' | 'CHUNKING' | 'VECTORIZING' | 'INDEXED'

// LLM 消息（Vercel AI SDK 协议）
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}
