/**
 * ChatMemory —— 记忆策略接口
 * MySQL 持久化；实现：SlidingWindowMemory + SummaryMemory（摘要压缩）
 */
import type { Message } from '@prisma/client'

/** AI SDK 消息格式 */
export interface ChatMemoryMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface MemoryMeta {
  tokenCount?: number
  toolCalls?: unknown
  /** 引用来源（随消息落库，刷新/切会话后历史消息仍可渲染） */
  citations?: unknown
  /** 推荐追问（同上） */
  recommendations?: unknown
}

export interface ChatMemory {
  /** 加载历史记忆（最近 N 轮原文） */
  load(sessionId: string): Promise<ChatMemoryMessage[]>
  /** 追加一条消息 */
  append(sessionId: string, message: ChatMemoryMessage, meta?: MemoryMeta): Promise<void>
}

/** Prisma Message → ChatMemoryMessage */
export function toMemoryMessage(m: Message): ChatMemoryMessage {
  return { role: m.role, content: m.content }
}

/** 原文窗口最大字符（2200） */
export const MAX_RECENT_CHARS = 2200

/**
 * 按字符预算截断消息列表（最近消息优先，靠前消息完整保留，超预算的最后一条按字符截断保留开头）
 * 入参须为正序（最早在前）；返回同样正序
 */
export function trimToChars(msgs: Message[], maxChars = MAX_RECENT_CHARS): Message[] {
  let total = 0
  const out: Message[] = []
  for (const m of msgs) {
    const len = m.content.length
    if (total + len > maxChars) {
      const remaining = maxChars - total
      if (remaining > 0) out.push({ ...m, content: m.content.slice(0, remaining) })
      break
    }
    out.push(m)
    total += len
  }
  return out
}
