/**
 * Vercel AI SDK useChat 封装
 * 透传 sessionId / chatMode / selectedDocumentId
 * onFinish 持久化会话；setMessages 供切换会话时加载历史消息
 */
import { useChat as useAiChat } from '@ai-sdk/vue'
import { computed, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'

export function useChatSession(
  sessionId: string,
  chatModeRef: Ref<string>,
  selectedDocumentIdRef: Ref<string>,
) {
  // body 传 computed ref，useChat 每次请求取最新值，切换模式/文档无需重建会话；
  // 不用 experimental_prepareRequestBody（experimental API 易变，且其 requestBody 不含 id/messages 会 400）
  const chatBody = computed(() => ({
    sessionId,
    chatMode: chatModeRef.value,
    selectedDocumentId: selectedDocumentIdRef.value || undefined,
  }))

  const { messages, input, handleSubmit, isLoading, stop, error, data, setMessages } = useAiChat({
    api: '/api/v1/chat',
    headers: {
      Authorization: `Bearer ${useAuthStore().token}`,
    },
    body: chatBody,
    onFinish: (msg) => useChatStore().persist(sessionId, msg),
    onError: (e) => ElMessage.error(e.message),
  })
  return { messages, input, handleSubmit, isLoading, stop, error, data, setMessages }
}
