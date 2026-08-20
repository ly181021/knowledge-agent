<script setup lang="ts">
/**
 * BusinessChatView —— 终端用户聊天主界面
 * 左侧 ChatSidebar（会话列表 + 收起）+ 右侧聊天区
 */
import { ref, onMounted } from 'vue'
import { chatApi, type SessionItem } from '@/api/chat'
import { useAuthStore } from '@/stores/auth'
import Chat from '@/components/Chat.vue'
import ChatSidebar from '@/components/sidebar/ChatSidebar.vue'

const auth = useAuthStore()
const currentSessionId = ref<string>('')
const sidebarRef = ref<InstanceType<typeof ChatSidebar>>()
const mobileSidebarOpen = ref(false)

function switchSession(id: string) {
  currentSessionId.value = id
}

function onNewChat(id: string) {
  // ChatSidebar 已往列表插入临时项，这里只需切换当前会话
  currentSessionId.value = id
}

async function loadSessions() {
  await sidebarRef.value?.loadSessions()
}

function toggleMobileSidebar() {
  mobileSidebarOpen.value = !mobileSidebarOpen.value
}

onMounted(async () => {
  await loadSessions()
  if (auth.previewMode) {
    const sessions = (await chatApi.listSessions()) as unknown as SessionItem[]
    if (sessions.length > 0) currentSessionId.value = sessions[0]!.id
    return
  }
  const sessions = (await chatApi.listSessions()) as unknown as SessionItem[]
  if (sessions.length > 0) {
    currentSessionId.value = sessions[0]!.id
  } else {
    // 无历史会话则新建（侧栏 expose 的 startNewSession 会插临时项并 emit newChat）
    const id = sidebarRef.value?.startNewSession()
    if (id) currentSessionId.value = id
  }
})
</script>

<template>
  <div class="chat-layout">
    <!-- 移动端 toggle（仅 ≤768px 显示） -->
    <button
      class="sidebar-toggle"
      :aria-label="mobileSidebarOpen ? '关闭会话列表' : '打开会话列表'"
      :aria-expanded="mobileSidebarOpen"
      @click="toggleMobileSidebar"
    >
      <span aria-hidden="true">☰</span>
    </button>

    <ChatSidebar
      ref="sidebarRef"
      :current-session-id="currentSessionId"
      :mobile-open="mobileSidebarOpen"
      :preview-mode="auth.previewMode"
      @select="switchSession"
      @new-chat="onNewChat"
      @update:mobile-open="mobileSidebarOpen = $event"
    />

    <!-- 移动端遮罩 -->
    <div
      v-if="mobileSidebarOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="mobileSidebarOpen = false"
    />

    <main class="chat-main">
      <Chat
        v-if="currentSessionId"
        :key="currentSessionId"
        :session-id="currentSessionId"
        @response-finished="loadSessions"
      />
    </main>
  </div>
</template>

<style scoped>
.chat-layout { display: flex; height: 100vh; background: var(--sa-bg); }
.chat-main { flex: 1; display: flex; flex-direction: column; background: var(--sa-bg); min-width: 0; }

.sidebar-toggle {
  display: none;
  position: fixed; top: 12px; left: 12px; z-index: 20;
  width: var(--sa-touch-target); height: var(--sa-touch-target);
  border: 1px solid var(--sa-border-input); border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-input); color: var(--sa-text-primary);
  font-size: 18px; cursor: pointer;
  align-items: center; justify-content: center;
  box-shadow: var(--sa-shadow);
}
.sidebar-toggle:hover { background: var(--sa-bg-hover); }
.sidebar-toggle:focus-visible { outline: none; box-shadow: var(--sa-focus-ring); }

.sidebar-backdrop {
  position: fixed; inset: 0;
  background: var(--sa-overlay);
  z-index: 15;
}

@media (max-width: 768px) {
  .sidebar-toggle { display: inline-flex; }
}
</style>
