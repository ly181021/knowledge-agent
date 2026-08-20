<script setup lang="ts">
/**
 * SessionItem —— 单会话项
 * 展开态：SVG 气泡图标 + 标题 + 相对时间 + active 左侧竖条
 * 收起态：只显图标（活跃项赤陶描边 + 暖陶底）
 */
import { computed } from 'vue'
import { formatRelativeTime } from '@/utils/relative-time'

const props = defineProps<{
  title: string
  updatedAt: string
  active: boolean
  collapsed: boolean
}>()

defineEmits<{ select: [] }>()

const time = computed(() => formatRelativeTime(props.updatedAt))
</script>

<template>
  <div
    :class="['session-item', { active, collapsed }]"
    data-test="session-item"
    :title="collapsed ? title : undefined"
    role="button"
    tabindex="0"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
    @keydown.space.prevent="$emit('select')"
  >
    <span v-if="active && !collapsed" class="active-bar" aria-hidden="true"></span>
    <span class="session-icon-wrap" aria-hidden="true">
      <!-- 对话气泡 SVG 描边图标，继承 currentColor -->
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </span>
    <span v-if="!collapsed" class="session-title">{{ title || '新对话' }}</span>
    <span v-if="!collapsed" class="session-time">{{ time }}</span>
  </div>
</template>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--sa-radius-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--sa-text-regular);
  margin-bottom: 1px;
  position: relative;
  transition: background 0.15s ease;
}
.session-item:hover { background: var(--sa-bg-hover); }
.session-item:focus-visible { outline: none; box-shadow: var(--sa-focus-ring); }
.session-item.active { background: var(--sa-bg-active); color: var(--sa-text-primary); }

/* 左侧赤陶竖条：active 会话标识 */
.active-bar {
  position: absolute;
  left: 0; top: 6px; bottom: 6px;
  width: 2px;
  background: var(--sa-primary);
  border-radius: 0 2px 2px 0;
}

.session-icon-wrap { color: var(--sa-text-secondary); flex-shrink: 0; display: flex; }
.session-item.active .session-icon-wrap { color: var(--sa-primary); }

.session-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  font-weight: 500;
}
.session-item.active .session-title { font-weight: 600; }

.session-time {
  font-size: 11px;
  color: var(--sa-text-secondary);
  white-space: nowrap;
  font-family: var(--sa-font-mono);
  flex-shrink: 0;
}

/* 收起态：居中只显图标，左右无 padding 真正居中，活跃项底色更突出 */
.session-item.collapsed { justify-content: center; padding: 8px 0; }
.session-item.collapsed.active { background: var(--sa-bg-active); }
.session-item.collapsed.active .session-icon-wrap { color: var(--sa-primary); }
</style>
