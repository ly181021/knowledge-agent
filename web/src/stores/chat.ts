/**
 * chat store —— src/stores/chat.ts
 * 会话列表 + 当前会话 + 会话级问答模式记忆
 * chatMode 采用前端按 sessionId 记忆的方式（不改后端 schema），
 * 切回旧会话时由 Chat.vue 读取并恢复 UI 状态。
 * 模式记忆持久化到 localStorage：pinia 是内存 store，刷新页面即清空，
 * 不持久化会导致刷新后模式回到默认值。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMode } from '@/types/chat-mode'
import { DEFAULT_CHAT_MODE } from '@/types/chat-mode'

/** 模式记忆的 localStorage key */
const MODES_STORAGE_KEY = 'sa-chat-modes'

/** 从 localStorage 恢复模式记忆（损坏/不可用时回退空对象） */
function loadModes(): Record<string, SessionMode> {
  try {
    return JSON.parse(localStorage.getItem(MODES_STORAGE_KEY) ?? '{}') as Record<string, SessionMode>
  } catch {
    return {}
  }
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string
}

/** 单会话的模式记忆 */
export interface SessionMode {
  chatMode: ChatMode
  selectedDocumentId: string
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([])
  const currentSessionId = ref<string>('')
  const currentSession = ref<ChatSession | null>(null)
  // 会话级模式记忆：sessionId → 模式状态（初始化时从 localStorage 恢复）
  const sessionModes = ref<Record<string, SessionMode>>(loadModes())

  function setCurrentSession(id: string) {
    currentSessionId.value = id
    currentSession.value = sessions.value.find((s) => s.id === id) ?? null
  }

  function newSession(id: string, title = '新对话') {
    const session: ChatSession = { id, title, createdAt: new Date().toISOString() }
    sessions.value.unshift(session)
    setCurrentSession(id)
    return session
  }

  function persist(sessionId: string, msg: unknown) {
    // 持久化由后端 MySQL 完成，前端只记 sessionId
    void sessionId
    void msg
  }

  /** 读取某会话的模式记忆，无则返回默认值 */
  function getSessionMode(sessionId: string): SessionMode {
    return (
      sessionModes.value[sessionId] ?? {
        chatMode: DEFAULT_CHAT_MODE,
        selectedDocumentId: '',
      }
    )
  }

  /** 更新某会话的模式记忆（partial 合并）+ 持久化到 localStorage */
  function setSessionMode(sessionId: string, partial: Partial<SessionMode>) {
    const cur = getSessionMode(sessionId)
    sessionModes.value[sessionId] = { ...cur, ...partial }
    try {
      localStorage.setItem(MODES_STORAGE_KEY, JSON.stringify(sessionModes.value))
    } catch {
      // localStorage 不可用（隐私模式/超限）不阻塞主流程
    }
  }

  return {
    sessions,
    currentSessionId,
    currentSession,
    sessionModes,
    setCurrentSession,
    newSession,
    persist,
    getSessionMode,
    setSessionMode,
  }
})
