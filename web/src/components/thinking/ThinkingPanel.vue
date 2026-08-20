<script setup lang="ts">
/**
 * ThinkingPanel —— 思考过程侧边面板容器
 * 折叠/展开 + 组装 StepTimeline + RetrievalFunnel
 */
import { onMounted, onBeforeUnmount } from 'vue'
import StepTimeline from '../StepTimeline.vue'
import RetrievalFunnel from '../RetrievalFunnel.vue'
import type { ThinkingTrace } from '@/types/thinking'

const props = defineProps<{
  trace: ThinkingTrace | null
  collapsed: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

// Esc 收起面板，避免键盘用户被困在面板内
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.collapsed) {
    emit('toggle')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside
    class="thinking-panel"
    :class="{ collapsed }"
    role="complementary"
    aria-label="思考过程"
  >
    <header class="panel-header">
      <span class="panel-title">✦ 思考过程</span>
      <button
        type="button"
        class="toggle-btn"
        data-test="toggle-btn"
        :aria-label="collapsed ? '展开思考过程' : '收起思考过程'"
        :aria-expanded="!collapsed"
        @click="emit('toggle')"
      >
        {{ collapsed ? '展开' : '收起' }}
      </button>
    </header>

    <div v-show="!collapsed" class="panel-body">
      <div v-if="!trace || trace.steps.length === 0" class="empty">本次无思考过程</div>
      <template v-else>
        <StepTimeline :steps="trace.steps" />
        <RetrievalFunnel :steps="trace.steps" />
      </template>
    </div>
  </aside>
</template>

<style scoped>
.thinking-panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--sa-bg-card);
  border-left: 1px solid var(--sa-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
}
.thinking-panel.collapsed { width: 48px; }
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sa-border);
}
.thinking-panel.collapsed .panel-header { flex-direction: column; gap: 8px; padding: 12px 6px; }
.panel-title { font-size: 14px; font-weight: 600; color: var(--sa-text-primary); }
.thinking-panel.collapsed .panel-title { writing-mode: vertical-rl; font-size: 12px; }
.toggle-btn {
  border: 1px solid var(--sa-border-input);
  background: var(--sa-bg-input);
  border-radius: var(--sa-radius-sm);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--sa-text-regular);
  cursor: pointer;
  transition: var(--sa-transition);
}
.toggle-btn:hover { border-color: var(--sa-primary); color: var(--sa-primary); }
.panel-body { flex: 1; overflow-y: auto; padding: 14px; }
.empty { color: var(--sa-text-secondary); font-size: 13px; text-align: center; padding: 24px 0; }
@media (prefers-reduced-motion: reduce) { .thinking-panel { transition: none; } }
</style>
