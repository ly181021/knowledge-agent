<script setup lang="ts">
/**
 * ThinkingLantern —— 右侧悬浮思考卡片
 * 进行时：右侧浮起卡片，琥珀脉冲光晕 + StepAxis active 态
 * 完成时：自动收起成右侧竖条（带思考图标），点击重新展开回看
 * 不占文档流（position: fixed/absolute），回答和引用完整可见
 * 复用 StepTimeline + RetrievalFunnel 展开详情
 */
import { ref, computed, watch } from 'vue'
import StepAxis from './StepAxis.vue'
import StepTimeline from '../StepTimeline.vue'
import RetrievalFunnel from '../RetrievalFunnel.vue'
import type { ThinkingTrace, PrepareStep } from '@/types/thinking'

const props = defineProps<{
  trace: ThinkingTrace | null
  /** 是否正在生成（isLoading） */
  loading: boolean
}>()

// 折叠态：loading 结束后自动收起成竖条；用户可手动展开回看
const collapsed = ref(false)

// 当前 active 步骤索引：loading 中=已收到的 steps 数（都是 done）
const currentIndex = computed(() => (props.trace ? props.trace.steps.length : 0))

const finished = computed(() => !props.loading)

const hasContent = computed(() => Boolean(props.trace && props.trace.steps.length > 0))

// 是否应该显示（有内容 或 正在 loading）
const visible = computed(() => hasContent.value || props.loading)

const STEP_LABEL_MAP: Record<PrepareStep, string> = {
  rewrite: '改写问题',
  subQuestion: '子问题拆分',
  scopeShrink: '知识域收缩',
  clarification: '歧义检测',
  route: '路由判定',
  retrieval: '检索召回',
}

const titleText = computed(() => {
  if (!hasContent.value) return '正在思考'
  if (props.loading) {
    const last = props.trace!.steps[props.trace!.steps.length - 1]
    const label = last ? (STEP_LABEL_MAP[last.step] ?? last.step) : ''
    return `正在思考 · ${label}`
  }
  return '思考过程'
})

const totalMs = computed(() => {
  if (!props.trace) return 0
  return props.trace.steps.reduce(
    (sum, s) => sum + (typeof s.payload?.durationMs === 'number' ? s.payload.durationMs : 0),
    0,
  )
})

// loading 开始时自动展开（新一轮提问），完成后不自动收起（用户手动控制）
watch(
  () => props.loading,
  (isLoading, prev) => {
    if (isLoading && !prev) collapsed.value = false
  },
)

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <div
    v-if="visible"
    :class="['thinking-lantern', { active: loading, done: !loading, collapsed }]"
    data-test="thinking-lantern"
  >
    <!-- 竖条态（收起）：只有一个小图标按钮 -->
    <button
      v-if="collapsed"
      class="lantern-rail"
      :aria-label="'展开思考过程'"
      data-test="lantern-rail"
      @click="toggle"
    >
      <span class="rail-icon" aria-hidden="true">✦</span>
      <span v-if="loading" class="rail-pulse" aria-hidden="true"></span>
    </button>

    <!-- 卡片态（展开） -->
    <div v-else class="lantern-card">
      <div
        class="lantern-header"
        role="button"
        tabindex="0"
        :aria-expanded="!collapsed"
        @click="toggle"
        @keydown.enter="toggle"
        @keydown.space.prevent="toggle"
      >
        <div class="lantern-title">
          <span class="pulse-dot" aria-hidden="true"></span>
          <span>{{ titleText }}</span>
        </div>
        <div v-if="!loading" class="lantern-meta">{{ (totalMs / 1000).toFixed(1) }}s</div>
        <button
          class="lantern-close"
          :aria-label="'收起思考过程'"
          @click.stop="toggle"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div class="lantern-body">
        <StepAxis :steps="trace?.steps ?? []" :current-index="currentIndex" :finished="finished" />
        <div class="lantern-detail">
          <StepTimeline :steps="trace?.steps ?? []" />
          <RetrievalFunnel :steps="trace?.steps ?? []" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking-lantern {
  position: absolute;
  right: 24px;
  top: 16px;
  z-index: 10;
  width: 256px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
}

/* === 竖条态 === */
.lantern-rail {
  align-self: flex-end;
  position: relative;
  width: 32px;
  height: 96px;
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-full);
  background: var(--sa-bg-card);
  box-shadow: var(--sa-shadow);
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10px;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.lantern-rail:hover { background: var(--sa-bg-hover); border-color: var(--sa-primary); }
.rail-icon { color: var(--sa-primary); font-size: 14px; }
/* 进行时竖条带琥珀脉冲光晕 */
.thinking-lantern.active .lantern-rail {
  border-color: var(--sa-amber);
  box-shadow: var(--sa-glow-amber-strong);
}
.rail-pulse {
  position: absolute;
  top: 6px; left: 50%;
  transform: translateX(-50%);
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--sa-amber);
  animation: rail-blink 1.4s ease-in-out infinite;
}
@keyframes rail-blink { 0%,100%{opacity:.3} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce) { .rail-pulse { animation: none; opacity: 0.7; } }

/* === 卡片态 === */
.lantern-card {
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-primary);
  border-radius: var(--sa-radius-md);
  box-shadow: var(--sa-shadow-pop);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: inherit;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
/* 完成态：边框转常规发丝线，光晕消退 */
.thinking-lantern.done .lantern-card { border-color: var(--sa-border); box-shadow: var(--sa-shadow); }

.lantern-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.lantern-header:hover { background: var(--sa-bg-hover); }
.lantern-header:focus-visible { outline: none; box-shadow: var(--sa-focus-ring); }

.lantern-title {
  display: flex; align-items: center; gap: 8px; flex: 1;
  font-size: 13px; font-weight: 600; color: var(--sa-text-primary);
}
.pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sa-primary); flex-shrink: 0; }
.thinking-lantern.active .pulse-dot {
  background: var(--sa-amber);
  animation: sa-dot-pulse 1.4s ease-in-out infinite;
}
@keyframes sa-dot-pulse { 0%,100%{opacity:.5;transform:scale(.8)} 50%{opacity:1;transform:scale(1.1)} }
@media (prefers-reduced-motion: reduce) { .thinking-lantern.active .pulse-dot { animation: none; opacity: 0.7; } }

.lantern-meta { font-size: 12px; color: var(--sa-text-secondary); font-family: var(--sa-font-mono); flex-shrink: 0; }

.lantern-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0;
  border: none; background: transparent;
  color: var(--sa-text-secondary);
  cursor: pointer; flex-shrink: 0;
  border-radius: 4px;
  transition: background 0.15s ease, color 0.15s ease;
}
.lantern-close:hover { background: var(--sa-bg-hover); color: var(--sa-primary); }
.lantern-close svg { transition: transform 0.2s ease; }

.lantern-body { border-top: 1px solid var(--sa-border); overflow-y: auto; }
.lantern-detail { padding: 12px 14px; }

/* === 响应式：窄屏改底部抽屉 === */
@media (max-width: 768px) {
  .thinking-lantern {
    right: 12px; left: 12px;
    top: auto; bottom: 12px;
    width: auto;
    max-height: 50vh;
  }
  .lantern-rail { align-self: flex-end; }
}
</style>
