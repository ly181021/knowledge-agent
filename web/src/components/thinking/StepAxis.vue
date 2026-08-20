<script setup lang="ts">
/**
 * StepAxis —— 横向三态（四态）时间轴
 * done（赤陶实色）/ active（琥珀脉冲）/ todo（灰描边）/ skipped（灰半透明）
 * 颜色编码即语义：琥珀=过程，赤陶=结果
 */
import { computed } from 'vue'
import type { ThinkingStep, PrepareStep } from '@/types/thinking'

const props = withDefaults(
  defineProps<{
    steps: ThinkingStep[]
    /** 当前进行到第几步（0-based）；>= steps.length 表示全部完成 */
    currentIndex: number
    /** 是否已完成（回答结束），true 时全部转 done 无 active */
    finished?: boolean
  }>(),
  { finished: false },
)

const STEP_LABEL: Record<PrepareStep, string> = {
  rewrite: '改写',
  subQuestion: '拆分',
  scopeShrink: '收缩',
  clarification: '歧义',
  route: '路由',
  retrieval: '检索',
}

type NodeState = 'done' | 'active' | 'todo' | 'skipped'

interface AxisNode {
  step: PrepareStep
  label: string
  state: NodeState
  durationMs?: number
}

const nodes = computed<AxisNode[]>(() =>
  props.steps.map((s, i) => {
    const p = s.payload ?? {}
    const isSkipped = Boolean(p.skipped)
    let state: NodeState
    if (isSkipped) {
      state = 'skipped'
    } else if (props.finished || i < props.currentIndex) {
      state = 'done'
    } else if (i === props.currentIndex) {
      state = 'active'
    } else {
      state = 'todo'
    }
    return {
      step: s.step,
      label: STEP_LABEL[s.step] ?? s.step,
      state,
      durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
    }
  }),
)
</script>

<template>
  <div class="step-axis" role="list" aria-label="思考步骤进度">
    <div class="axis-track">
      <div
        v-for="(n, i) in nodes"
        :key="i"
        :class="['axis-node', n.state]"
        data-test="axis-node"
        role="listitem"
      >
        <span class="axis-dot" aria-hidden="true"></span>
        <!-- 连接线（最后一个不显示） -->
        <span
          v-if="i < nodes.length - 1"
          class="axis-line"
          :class="{ done: n.state === 'done' }"
          aria-hidden="true"
        ></span>
        <span class="axis-label">{{ n.label }}</span>
        <span v-if="n.state === 'done' && n.durationMs !== undefined" class="axis-time">{{ n.durationMs }}ms</span>
        <span v-else-if="n.state === 'active'" class="axis-time">⋯</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-axis { padding: 0 16px 14px; }
.axis-track { display: flex; align-items: flex-start; gap: 0; }
.axis-node {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  position: relative; flex: 1;
}
.axis-dot {
  width: 12px; height: 12px; border-radius: 50%; z-index: 2;
  background: var(--sa-bg-card); border: 2px solid var(--sa-border-input);
  transition: background 0.3s ease, border-color 0.3s ease;
}
.axis-node.done .axis-dot { background: var(--sa-primary); border-color: var(--sa-primary); }
.axis-node.active .axis-dot {
  background: var(--sa-amber); border-color: var(--sa-amber);
  box-shadow: var(--sa-glow-amber-strong);
  animation: sa-glow-pulse 1.4s ease-in-out infinite;
}
.axis-node.skipped .axis-dot { opacity: 0.5; }
@keyframes sa-glow-pulse {
  0%, 100% { transform: scale(0.85); box-shadow: 0 0 6px 2px rgba(232,168,124,.4); }
  50% { transform: scale(1.1); box-shadow: 0 0 12px 4px rgba(232,168,124,.6); }
}
@media (prefers-reduced-motion: reduce) {
  .axis-node.active .axis-dot { animation: none; }
}

.axis-line {
  position: absolute; top: 6px; left: 50%; right: -50%;
  height: 2px; background: var(--sa-border-input); z-index: 1;
}
.axis-line.done { background: var(--sa-primary); }
.axis-node:last-child .axis-line { display: none; }

.axis-label {
  font-size: 11px; color: var(--sa-text-secondary); font-weight: 500; white-space: nowrap;
}
.axis-node.done .axis-label { color: var(--sa-text-regular); }
.axis-node.active .axis-label { color: var(--sa-primary); font-weight: 600; }
.axis-time {
  font-size: 10px; color: var(--sa-text-secondary);
  font-family: var(--sa-font-mono);
}

/* 小屏：纵向排列 */
@media (max-width: 768px) {
  .axis-track { flex-direction: column; align-items: stretch; gap: 8px; }
  .axis-node { flex-direction: row; align-items: center; gap: 10px; }
  .axis-line { display: none; }
}
</style>
