/**
 * ChatMode —— 用户侧问答模式（ChatQueryMode）
 * 三种模式（前端按钮文案）：
 * - DOCUMENT       当前文档问答：限定在用户选中的单个文档内检索
 * - AUTO_DOCUMENT  自动知识问答：全库 RAG 检索（默认）
 * - OPEN_CHAT      开放式提问：自主决定是否检索知识库或联网搜索（ReAct 工具模式）
 * 值与后端 ChatQueryMode 枚举字符串一致，直接作为 body.chatMode 透传。
 */
export type ChatMode = 'DOCUMENT' | 'AUTO_DOCUMENT' | 'OPEN_CHAT'

export interface ChatModeMeta {
  value: ChatMode
  label: string
  desc: string
}

/** 模式元数据，供切换按钮组渲染 */
export const CHAT_MODES: ChatModeMeta[] = [
  { value: 'DOCUMENT', label: '当前文档问答', desc: '限定在你选中的单个文档内回答' },
  { value: 'AUTO_DOCUMENT', label: '自动知识问答', desc: '在全库知识中检索回答' },
  { value: 'OPEN_CHAT', label: '开放式提问', desc: '自主决定是否检索知识库或联网搜索，基于模型能力回答' },
]

/** 默认模式：自动知识问答（等价于改动前的行为） */
export const DEFAULT_CHAT_MODE: ChatMode = 'AUTO_DOCUMENT'
