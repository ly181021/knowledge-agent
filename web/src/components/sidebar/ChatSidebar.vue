<script setup lang="ts">
/**
 * ChatSidebar —— 侧栏容器
 * 桌面（>768px）：图标条收起模式（48px ↔ 260px），localStorage 持久化
 * 移动端（≤768px）：抽屉模式
 */
import { ref, computed, watch } from 'vue'
import SidebarHeader from './SidebarHeader.vue'
import SessionList from './SessionList.vue'
import SidebarFooter from './SidebarFooter.vue'
import { chatApi, type SessionItem } from '@/api/chat'

defineProps<{
  currentSessionId: string
  mobileOpen: boolean
  previewMode: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  newChat: [id: string]
  'update:mobileOpen': [val: boolean]
}>()

const sessions = ref<SessionItem[]>([])

// 桌面收起态：localStorage 持久化
const COLLAPSE_KEY = 'sa_sidebar_collapsed'
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')
watch(collapsed, (v) => localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'))

const sidebarWidth = computed(() => (collapsed.value ? '56px' : '260px'))

async function loadSessions() {
  try {
    sessions.value = (await chatApi.listSessions()) as unknown as SessionItem[]
  } catch {
    // 拉取失败不阻塞
  }
}

function onSelect(id: string) {
  emit('select', id)
  // 移动端选完即收抽屉
  if (window.matchMedia('(max-width: 768px)').matches) {
    emit('update:mobileOpen', false)
  }
}

function onNewChat() {
  startNewSession()
  // 移动端点新对话也收抽屉
  if (window.matchMedia('(max-width: 768px)').matches) {
    emit('update:mobileOpen', false)
  }
}

/** 新建会话：生成 id + 往列表头部插入临时项，返回 id 给父组件 */
function startNewSession(): string {
  const id = crypto.randomUUID()
  sessions.value.unshift({
    id,
    title: '新对话',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  emit('newChat', id)
  return id
}

defineExpose({ collapsed, loadSessions, startNewSession })
</script>

<template>
  <aside
    class="sidebar"
    :class="{ collapsed, 'mobile-open': mobileOpen }"
    :style="{ width: sidebarWidth }"
    role="navigation"
    aria-label="会话导航"
  >
    <SidebarHeader
      :collapsed="collapsed"
      @new-chat="onNewChat"
      @toggle-collapse="collapsed = !collapsed"
    />

    <div v-if="!previewMode" class="list-wrap">
      <SessionList
        :sessions="sessions"
        :active-id="currentSessionId"
        :collapsed="collapsed"
        @select="onSelect"
      />
    </div>

    <SidebarFooter :collapsed="collapsed" />
  </aside>
</template>

<style scoped>
.sidebar {
  flex-shrink: 0;
  background: var(--sa-bg-sidebar);
  display: flex; flex-direction: column;
  border-right: 1px solid var(--sa-border);
  transition: width 0.2s ease;
  overflow: hidden;
}
.list-wrap { flex: 1; min-height: 0; display: flex; }
.list-wrap > :deep(*) { flex: 1; }

/* 移动端抽屉模式：覆盖 width 计算 */
@media (max-width: 768px) {
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 260px !important;
    z-index: 16;
    transform: translateX(-100%);
  }
  .sidebar.mobile-open { transform: translateX(0); box-shadow: var(--sa-shadow-pop); }
}

/* prefers-reduced-motion：宽度过渡降级 instant */
@media (prefers-reduced-motion: reduce) {
  .sidebar { transition: none; }
}
</style>
