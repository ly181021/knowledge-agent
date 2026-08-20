<script setup lang="ts">
/**
 * SidebarHeader —— 品牌 + 新对话按钮 + 收起按钮
 * 收起按钮在 Knowledge Agent 右侧，纯图标（‹ 箭头），收起态转 180°（变 ›）
 */
defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  newChat: []
  toggleCollapse: []
}>()
</script>

<template>
  <div class="sidebar-header" :class="{ collapsed }">
    <div class="brand">
      <span class="brand-mark">✦</span>
      <span v-if="!collapsed" class="brand-name">Knowledge Agent</span>
      <button
        class="collapse-toggle"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        data-test="collapse-toggle"
        @click="emit('toggleCollapse')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>
    <button class="new-chat-btn" data-test="new-chat-btn" @click="emit('newChat')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span v-if="!collapsed" class="lbl">新对话</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-header { display: flex; flex-direction: column; gap: 12px; padding: 16px 14px 12px; }
.sidebar-header.collapsed { padding: 14px 8px 10px; align-items: stretch; }

.brand { display: flex; align-items: center; gap: 8px; }
.brand-mark { color: var(--sa-primary); font-size: 18px; flex-shrink: 0; }
.brand-name { font-size: 16px; font-weight: 600; color: var(--sa-text-primary); flex: 1; }
.sidebar-header.collapsed .brand { justify-content: center; }

/* 收起按钮：Knowledge Agent 右侧纯图标 */
.collapse-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: none; background: transparent;
  border-radius: var(--sa-radius-sm);
  color: var(--sa-text-secondary);
  cursor: pointer; flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.collapse-toggle:hover { background: var(--sa-bg-hover); color: var(--sa-primary); }
.collapse-toggle:focus-visible { outline: none; box-shadow: var(--sa-focus-ring); }
.collapse-toggle svg { transition: transform 0.2s ease; }
/* 收起态时图标转 180°（‹ 变 ›） */
.sidebar-header.collapsed .collapse-toggle svg { transform: rotate(180deg); }
.sidebar-header.collapsed .collapse-toggle { width: 24px; height: 24px; }

/* 新对话按钮：赤陶描边 + 淡陶底（侧栏唯一 CTA）*/
.new-chat-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--sa-primary); border-radius: var(--sa-radius-sm);
  background: var(--sa-primary-light);
  color: var(--sa-text-primary); font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.new-chat-btn:hover { background: var(--sa-bg-hover); border-color: var(--sa-primary-hover); }
.new-chat-btn svg { color: var(--sa-primary); flex-shrink: 0; }
.sidebar-header.collapsed .new-chat-btn { justify-content: center; padding: 8px 0; }
</style>
