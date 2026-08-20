/**
 * chat api —— 对话接口
 */
import { http } from './request'

export interface SessionItem {
  id: string
  title: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  /** 引用来源（随消息落库，刷新/切会话后恢复渲染） */
  citations?: unknown
  /** 推荐追问（同上） */
  recommendations?: unknown
}

export const chatApi = {
  listSessions() {
    return http.get<SessionItem[]>('/chat/sessions')
  },
  getMessages(sessionId: string) {
    return http.get<HistoryMessage[]>(`/chat/sessions/${sessionId}/messages`)
  },
  /** 当前文档问答可选文档列表（已索引文档） */
  listDocuments() {
    return http.get<{ id: string; title: string }[]>('/chat/documents')
  },
}
