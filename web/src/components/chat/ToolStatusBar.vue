<script setup lang="ts">
/**
 * ToolStatusBar —— ReAct 工具调用过程展示条
 * 显示本轮回答调用过的工具（running 动画 / 完成 ✓），暖色小 chip，不占文档流。
 */
import type { ToolStatusEvent } from '@/types/thinking'

defineProps<{
  events: ToolStatusEvent[]
  /** 请求是否进行中：进行中显示运行动画，结束显示完成态 */
  loading: boolean
}>()

/** 工具名 → 中文标签（新增工具在这里补） */
const TOOL_LABELS: Record<string, string> = {
  knowledgeSearch: '知识库检索',
  webSearch: '联网搜索',
}
</script>

<template>
  <div class="tool-status-bar">
    <span v-for="(ev, i) in events" :key="i" class="tool-status-chip" :class="{ running: loading }">
      <span class="tool-status-dot" />
      {{ TOOL_LABELS[ev.toolName] ?? ev.toolName }}
      <span v-if="!loading" class="tool-status-done">✓</span>
    </span>
  </div>
</template>

<style scoped>
.tool-status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 296px 0 24px; /* 与消息区对齐（右侧给悬浮卡留位） */
}
.tool-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: var(--sa-radius-full);
  background: var(--sa-bg-sidebar);
  border: 1px solid var(--sa-border);
  color: var(--sa-text-secondary);
}
.tool-status-chip.running {
  color: var(--sa-primary);
  border-color: var(--sa-primary);
}
.tool-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sa-primary);
  animation: sa-tool-pulse 1.2s ease-in-out infinite;
}
.tool-status-chip:not(.running) .tool-status-dot {
  background: var(--sa-text-placeholder);
  animation: none;
}
.tool-status-done {
  color: var(--sa-primary);
  font-size: 12px;
}
@keyframes sa-tool-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .tool-status-dot { animation: none; opacity: 0.6; }
}
@media (max-width: 640px) {
  .tool-status-bar { padding: 8px 12px 0; }
}
</style>
