<script setup lang="ts">
/**
 * Chat —— 对话主组件
 * 消息列表 + 输入框 + 发送/停止按钮
 * 切换会话时从后端加载历史消息
 * 三种问答模式（当前文档问答 / 自动知识问答 / 开放式提问）切换器 + 文档选择
 */
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useChatSession } from '@/composables/useChat'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { chatApi, type HistoryMessage } from '@/api/chat'
import MessageBubble from './MessageBubble.vue'
import { useThinkingStream } from '@/composables/useThinkingStream'
import ThinkingLantern from './thinking/ThinkingLantern.vue'
import { useToolStatusStream } from '@/composables/useToolStatusStream'
import ToolStatusBar from './chat/ToolStatusBar.vue'
import type { ThinkingTrace, ToolStatusEvent } from '@/types/thinking'
import { CHAT_MODES, DEFAULT_CHAT_MODE, type ChatMode } from '@/types/chat-mode'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ responseFinished: [] }>()

const chatStore = useChatStore()
const auth = useAuthStore()

// ===== 问答模式 + 文档选择（按 sessionId 记忆，切回会话时恢复）=====
const chatMode = ref<ChatMode>(DEFAULT_CHAT_MODE)
const selectedDocumentId = ref<string>('')
// 文档下拉选项（已索引文档），组件内缓存，多会话共享
const documentOptions = ref<{ id: string; title: string }[]>([])
const documentOptionsLoading = ref(false)

// 从 store 恢复该会话的模式记忆
function restoreMode(sessionId: string) {
  const saved = chatStore.getSessionMode(sessionId)
  chatMode.value = saved.chatMode
  selectedDocumentId.value = saved.selectedDocumentId
}

// 模式对应图标
function modeIcon(mode: ChatMode): string {
  return mode === 'DOCUMENT' ? '📄' : mode === 'AUTO_DOCUMENT' ? '📚' : '💬'
}

// 模式/文档变化时持久化到 store（按当前 sessionId）
function persistMode() {
  chatStore.setSessionMode(props.sessionId, {
    chatMode: chatMode.value,
    selectedDocumentId: selectedDocumentId.value,
  })
}

function onModeChange(mode: ChatMode) {
  chatMode.value = mode
  persistMode()
}

function onDocumentChange(id: string) {
  selectedDocumentId.value = id
  persistMode()
}

async function loadDocumentOptions() {
  if (documentOptions.value.length > 0) return
  documentOptionsLoading.value = true
  try {
    documentOptions.value = (await chatApi.listDocuments()) as unknown as { id: string; title: string }[]
  } catch {
    // 加载失败不阻塞，下拉会显示空
  } finally {
    documentOptionsLoading.value = false
  }
}

// DOCUMENT 模式未选文档时禁止发送
const canSend = computed(() => {
  if (!input.value.trim()) return false
  if (chatMode.value === 'DOCUMENT' && !selectedDocumentId.value) return false
  return true
})

// useChatSession 传入 chatMode / selectedDocumentId 的 ref（发送时动态读取当前值）
const { messages, input, handleSubmit, isLoading, stop, data, setMessages } = useChatSession(
  props.sessionId,
  chatMode,
  selectedDocumentId,
)

// 思考过程：pendingMessageId 在提交时生成，正文建立后迁移到真实 assistant id
const pendingMessageId = ref<string>('')
const { thinkingMap, freezeCurrent, migrateTrace } = useThinkingStream({
  data,
  messages,
  pendingMessageId,
})

// ReAct 工具调用过程：同样走 data 帧 + pending 累积 + 迁移（ToolStatusBar 渲染）
const { toolStatusMap, freezeCurrent: freezeToolStatus, migrateTrace: migrateToolStatus } = useToolStatusStream({
  data,
  messages,
  pendingMessageId,
})

// 当前要展示的工具状态：优先当前 pending，其次最新 frozen
const currentToolStatus = computed<ToolStatusEvent[] | null>(() => {
  if (pendingMessageId.value) {
    const list = toolStatusMap.value.get(pendingMessageId.value)
    if (list && list.length > 0) return list
  }
  // 找最新一条 assistant 消息对应的工具列表
  const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
  if (lastAssistant) {
    const list = toolStatusMap.value.get(lastAssistant.id)
    if (list && list.length > 0) return list
  }
  return null
})

// 当前要展示的 trace：优先当前 pending，其次最新 frozen
const currentTrace = computed<ThinkingTrace | null>(() => {
  if (pendingMessageId.value) {
    const t = thinkingMap.value.get(pendingMessageId.value)
    if (t) return t
  }
  // 找最新一条 assistant 消息对应的 trace
  const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
  if (lastAssistant) {
    return thinkingMap.value.get(lastAssistant.id) ?? null
  }
  return null
})

const messagesContainer = ref<HTMLElement>()

// 切换会话时从后端加载历史消息（含引用/推荐，恢复渲染）
async function loadHistory(sessionId: string) {
  try {
    const res = (await chatApi.getMessages(sessionId)) as unknown as HistoryMessage[]
    if (res && res.length > 0) {
      // 把后端历史消息喂给 useChat
      setMessages(
        res.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      )
      // 恢复历史消息的引用/推荐：key 用后端消息 id（与上面 setMessages 的 id 一致）
      const restored: Record<string, unknown[]> = {}
      for (const m of res) {
        const parts: unknown[] = []
        if (m.citations) parts.push({ type: 'citations', value: m.citations })
        if (m.recommendations) parts.push({ type: 'recommendations', value: m.recommendations })
        if (parts.length > 0) restored[m.id] = parts
      }
      messageDataMap.value = restored
    } else {
      setMessages([])
      messageDataMap.value = {}
    }
  } catch {
    // 拉取失败不阻塞，useChat 会显示空消息
  }
}

onMounted(() => {
  restoreMode(props.sessionId)
  loadHistory(props.sessionId)
  // 预加载文档选项（DOCUMENT 模式下拉用，懒加载也行，这里一次性拉取缓存）
  loadDocumentOptions()
})

// sessionId 变化时重新加载历史 + 恢复该会话的模式记忆
watch(
  () => props.sessionId,
  (newId) => {
    restoreMode(newId)
    loadHistory(newId)
  },
)

// 消息更新自动滚到底 + 回答完成时通知父组件刷新会话标题
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    messagesContainer.value?.scrollTo({ top: messagesContainer.value.scrollHeight, behavior: 'smooth' })
  },
)

// isLoading 从 true → false 表示回答完成
watch(isLoading, (loading, prev) => {
  if (prev && !loading) {
    // 冻结当前 pending trace/tool-status，并迁移到真实 assistant messageId
    const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
    const pid = pendingMessageId.value
    freezeCurrent()
    freezeToolStatus()
    if (lastAssistant && pid && pid !== lastAssistant.id) {
      migrateTrace(pid, lastAssistant.id)
      migrateToolStatus(pid, lastAssistant.id)
    }
    pendingMessageId.value = ''
    // 延迟 3s 等 LLM 生成标题后刷新会话列表
    setTimeout(() => emit('responseFinished'), 3000)
  }
})

// 兜底：消息数量增加时也尝试刷新（当 watch isLoading 没触发时）
watch(
  () => messages.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen && oldLen > 0) {
      setTimeout(() => emit('responseFinished'), 3000)
    }
  },
)

function onSubmit(e: Event) {
  e.preventDefault()
  // DOCUMENT 模式必须先选文档
  if (chatMode.value === 'DOCUMENT' && !selectedDocumentId.value) {
    ElMessage.warning('请先选择一个文档再发送问题')
    return
  }
  // 生成 pending messageId 给思考流累积（正文建立后迁移）
  pendingMessageId.value = `pending-${Date.now()}`
  handleSubmit(e)
}

// messageId → citations/recommendations 帧，渲染时经 getMessageData 取用。
// useChat 的 data 跨请求只增不减，因此按位置（dataProcessedCount）只累积本次新增的帧，旧请求的帧不会残留；
// 历史消息的引用/推荐由 loadHistory 按后端消息 id 恢复。
const messageDataMap = ref<Record<string, unknown[]>>({})

// 已处理的 data part 数量（按位置去重，与 useThinkingStream 同款策略）
let dataProcessedCount = 0

// 监听全局 data 变化，把本次新增的引用/推荐帧关联到最新一条 assistant 消息
watch(
  () => data.value,
  (val) => {
    if (!val) return
    const parts = Array.isArray(val) ? val : [val]
    // 防御性兜底：若 data 被替换为更短的数组（理论上不会发生），重置计数避免越界
    if (parts.length < dataProcessedCount) dataProcessedCount = 0
    const newParts = parts.slice(dataProcessedCount)
    dataProcessedCount = parts.length
    // 只处理新增帧里的 citations / recommendations（progress 等不触发）
    const relevant = newParts.filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        ((p as { type?: string }).type === 'citations' || (p as { type?: string }).type === 'recommendations'),
    )
    if (relevant.length === 0) return
    // 找最新一条 assistant 消息（citations/recommendations 帧在回答结束后到达，消息已完整）
    const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return
    // 追加到该消息（同一请求内 citations 先到、recommendations 后到，顺序保留）
    const existing = messageDataMap.value[lastAssistant.id] ?? []
    messageDataMap.value[lastAssistant.id] = [...existing, ...relevant]
  },
  { deep: true },
)

function getMessageData(m: { id: string; role: string }): unknown {
  // 只有 assistant 消息才有关联的 citations / recommendations
  if (m.role !== 'assistant') return undefined
  return messageDataMap.value[m.id]
}

// 推荐追问点击：回填输入框并发送
function onSelectRecommendation(question: string) {
  input.value = question
  // 等下一帧让 input 更新后再提交，避免 v-model 未同步
  nextTick(() => {
    handleSubmit(new Event('submit'))
  })
}
</script>

<template>
  <div class="chat-with-thinking">
    <div class="chat-container">
      <!-- ReAct 工具调用过程条（OPEN_CHAT 模式有工具调用时显示） -->
      <ToolStatusBar v-if="currentToolStatus" :events="currentToolStatus" :loading="isLoading" />
      <div ref="messagesContainer" class="messages">
        <div class="messages-inner">
        <div v-if="messages.length === 0" class="empty">
          <div class="empty-icon">✦</div>
          <div class="empty-title">有什么可以帮你？</div>
          <div class="empty-hint">基于已上传的知识库回答你的问题</div>
        </div>
        <template v-for="(m, idx) in messages" :key="m.id">
          <!-- 正在思考：紧贴流式输出内容的最前面（最后一条 assistant 消息正上方） -->
          <div v-if="isLoading && idx === messages.length - 1 && m.role === 'assistant'" class="loading">
            <span class="loading-dot"></span>
            正在思考...
          </div>
          <MessageBubble
            :role="(m.role as 'user' | 'assistant' | 'system')"
            :content="m.content"
            :data="getMessageData(m)"
            @select="onSelectRecommendation"
          />
        </template>
        <!-- assistant 消息尚未建立（刚发送）时，loading 兜底显示在列表尾部 -->
        <div
          v-if="isLoading && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant'"
          class="loading"
        >
          <span class="loading-dot"></span>
          正在思考...
        </div>
        </div>
      </div>

      <form v-if="!auth.previewMode" class="input-bar" @submit="onSubmit">
        <div class="input-wrap">
          <div class="input-area">
            <el-input
              v-model="input"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 6 }"
              :placeholder="chatMode === 'DOCUMENT' && !selectedDocumentId ? '请先选择文档' : '有什么可以帮你？'"
              @keydown.enter.exact.prevent="onSubmit"
            />
            <button
              v-if="!isLoading"
              type="submit"
              class="send-btn"
              :disabled="!canSend"
              aria-label="发送消息"
            >
              ↑
            </button>
            <button v-else type="button" class="stop-btn" aria-label="停止生成" @click="stop">
              ■
            </button>
          </div>
          <div class="tool-bar">
            <div class="mode-switch" role="tablist" aria-label="问答模式">
              <button
                v-for="m in CHAT_MODES"
                :key="m.value"
                type="button"
                role="tab"
                :aria-selected="chatMode === m.value"
                :class="['tool-chip', { active: chatMode === m.value }]"
                :title="m.desc"
                @click="onModeChange(m.value)"
              >
                <span class="tool-chip-icon">{{ modeIcon(m.value) }}</span>
                <span class="tool-chip-label">{{ m.label }}</span>
              </button>
            </div>
            <div class="tool-divider" />
            <el-select
              v-if="chatMode === 'DOCUMENT'"
              v-model="selectedDocumentId"
              class="doc-select"
              placeholder="选择文档"
              :loading="documentOptionsLoading"
              size="small"
              no-data-text="暂无已索引文档"
              @change="onDocumentChange"
            >
              <el-option v-for="d in documentOptions" :key="d.id" :label="d.title" :value="d.id" />
            </el-select>
          </div>
        </div>
      </form>
      <div v-else class="preview-input-bar">
        当前为演示模式 · 输入已禁用
      </div>
    </div>

    <!-- 思考灯箱：右侧悬浮卡片，不占文档流；进行时弹出，完成后收起成竖条 -->
    <ThinkingLantern :trace="currentTrace" :loading="isLoading" />
  </div>
</template>

<style scoped>
.chat-with-thinking { position: relative; display: block; height: 100%; background: var(--sa-bg); }
.chat-with-thinking .chat-container { height: 100%; }
.chat-container { display: flex; flex-direction: column; height: 100%; background: var(--sa-bg); }

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 296px 12px 24px;  /* 右侧 296px 给悬浮卡留位（256卡+24右+16间隙） */
}
/* 内层：在侧栏右与卡片左之间的可用空间内居中，max-width 保持 740px 阅读宽 */
.messages-inner {
  max-width: 740px;
  margin: 0 auto;
}

.empty {
  text-align: center;
  margin-top: 18vh;
}
.empty-icon {
  font-size: 32px;
  color: var(--sa-primary);
  margin-bottom: 16px;
}
.empty-title {
  font-size: 22px;
  font-weight: 300;
  color: var(--sa-text-primary);
  margin-bottom: 6px;
}
.empty-hint {
  font-size: 14px;
  color: var(--sa-text-secondary);
}

.loading {
  color: var(--sa-text-secondary);
  font-size: 14px;
  padding: 4px 0 8px; /* 顶部固定位：上间距小、下间距撑开与首条消息的呼吸感 */
  display: flex;
  align-items: center;
  gap: 8px;
}
.loading-dot {
  width: 8px; height: 8px;
  background: var(--sa-primary);
  border-radius: 50%;
  animation: sa-pulse 1.4s ease-in-out infinite;
}
@keyframes sa-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
/* 前庭功能敏感用户降级：停止脉冲，保留"正在思考..."文字反馈 */
@media (prefers-reduced-motion: reduce) {
  .loading-dot { animation: none; opacity: 0.6; }
}

.input-bar {
  padding: 8px 296px 24px 24px;  /* 右侧留卡片位，与消息区对齐 */
}
/* 内层限宽居中，与消息内容对齐 */
.input-bar .input-wrap {
  max-width: 740px;
  margin: 0 auto;
}

/* input-wrap 改为纵向：上输入区 + 下工具条，圆角由外层统一 */
.input-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--sa-bg-input);
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-lg);
  transition: var(--sa-transition);
  box-shadow: var(--sa-shadow);
  overflow: hidden;
}
.input-wrap:focus-within {
  border-color: var(--sa-primary);
  box-shadow: var(--sa-focus-ring);
}
/* 输入区：textarea + 发送按钮 */
.input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 8px 6px 4px;
}
.input-bar :deep(.el-textarea__inner) {
  border: none;
  background: transparent;
  border-radius: 0;
  padding: 8px 12px;
  font-size: 15px;
  resize: none;
  box-shadow: none;
  line-height: 1.5;
}
.input-bar :deep(.el-textarea__inner:focus) { box-shadow: none; }

/* 工具条：模式 chip + 分隔线 + 文档下拉 */
.tool-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--sa-border);
  flex-wrap: wrap;
}
.mode-switch {
  display: inline-flex;
  gap: 4px;
}
.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: var(--sa-bg-sidebar);
  color: var(--sa-text-secondary);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: var(--sa-radius-full);
  transition: var(--sa-transition);
  white-space: nowrap;
}
.tool-chip:hover {
  background: var(--sa-bg-hover);
  color: var(--sa-text-primary);
}
.tool-chip.active {
  background: var(--sa-primary);
  color: white;
  border-color: var(--sa-primary);
}
.tool-chip:focus-visible {
  outline: none;
  box-shadow: var(--sa-focus-ring);
}
.tool-chip-icon { font-size: 13px; line-height: 1; }
.tool-divider {
  width: 1px;
  height: 16px;
  background: var(--sa-border);
  margin: 0 2px;
  flex-shrink: 0;
}
.doc-select {
  width: 200px;
}
.doc-select :deep(.el-input__wrapper) {
  box-shadow: var(--sa-shadow);
}

.send-btn {
  width: var(--sa-touch-target); height: var(--sa-touch-target);
  border: none;
  background: var(--sa-primary);
  color: white;
  border-radius: 50%;
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--sa-transition);
}
.send-btn:hover:not(:disabled) { background: var(--sa-primary-hover); }
.send-btn:disabled { background: var(--sa-text-placeholder); cursor: not-allowed; }

.stop-btn {
  width: var(--sa-touch-target); height: var(--sa-touch-target);
  border: none;
  background: var(--sa-text-primary);
  color: white;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stop-btn:hover { opacity: 0.85; }

.preview-input-bar {
  max-width: 740px;
  width: 100%;
  margin: 0 auto;
  padding: 12px 296px 24px 24px;  /* 右侧留卡片位，与消息区对齐 */
  text-align: center;
  color: var(--sa-text-secondary);
  font-size: 13px;
  border-top: 1px dashed var(--sa-border);
}

/* 窄屏：消息区与输入栏贴边，去掉横向留白；
   悬浮卡片转底部抽屉，取消右侧预留空间 */
@media (max-width: 640px) {
  .messages { padding: 16px 12px 8px; }
  .input-bar { padding: 8px 12px 12px; }
  .empty { margin-top: 12vh; }
  .tool-bar { gap: 4px; padding: 6px; }
  .doc-select { width: 100%; }
}
</style>
