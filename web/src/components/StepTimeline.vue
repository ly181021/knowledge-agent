<script setup lang="ts">
/**
 * StepTimeline —— 责任链步骤时间线
 * 每步一行：图标 + 中文名 + 状态（已跳过/耗时） + payload 摘要
 * 走 v-text 不走 v-html，防 XSS
 */
import { computed } from 'vue'
import type { ThinkingStep, PrepareStep } from '@/types/thinking'

const props = defineProps<{ steps: ThinkingStep[] }>()

const STEP_LABEL: Record<PrepareStep, string> = {
  rewrite: '改写问题',
  subQuestion: '子问题拆分',
  scopeShrink: '知识域收缩',
  clarification: '歧义检测',
  route: '路由判定',
  retrieval: '检索召回',
}

const isEmpty = computed(() => props.steps.length === 0)

interface Row {
  step: PrepareStep
  label: string
  skipped: boolean
  durationMs?: number
  summary: string
}

const rows = computed<Row[]>(() =>
  props.steps.map((s) => {
    const p = s.payload ?? {}
    let summary = ''
    if (s.step === 'rewrite') {
      summary = p.skipped ? '(未改写)' : `"${String(p.from ?? '').slice(0, 20)}" → "${String(p.to ?? '').slice(0, 20)}"`
    } else if (s.step === 'subQuestion') {
      const qs = (p.questions as string[] | undefined) ?? []
      summary = qs.length > 1 ? `${qs.length} 个子问题` : '(未拆分)'
    } else if (s.step === 'route' || s.step === 'clarification') {
      summary = String(p.mode ?? '')
    } else if (s.step === 'retrieval') {
      const chs = (p.channels as { recalled: number; accepted: number }[] | undefined) ?? []
      summary = chs.map((c) => `${c.accepted}/${c.recalled}`).join(' + ') || '无召回'
    }
    return {
      step: s.step,
      label: STEP_LABEL[s.step],
      skipped: Boolean(p.skipped),
      durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
      summary,
    }
  }),
)
</script>

<template>
  <div class="step-timeline" role="log" aria-live="polite">
    <div v-if="isEmpty" class="empty">暂无思考过程</div>
    <div
      v-for="(r, i) in rows"
      :key="i"
      class="step-item"
      :class="{ skipped: r.skipped }"
      data-test="step-item"
    >
      <span class="dot" :class="{ skipped: r.skipped }" aria-hidden="true"></span>
      <span class="label">{{ r.label }}</span>
      <span v-if="r.skipped" class="skip-tag">已跳过</span>
      <span v-else-if="r.durationMs !== undefined" class="duration">{{ r.durationMs }}ms</span>
      <span v-if="r.summary" class="summary" v-text="r.summary"></span>
    </div>
  </div>
</template>

<style scoped>
.step-timeline { display: flex; flex-direction: column; gap: 6px; }
.empty { color: var(--sa-text-secondary); font-size: 13px; padding: 12px 0; text-align: center; }
.step-item {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--sa-text-regular);
  padding: 4px 0;
}
.step-item.skipped { opacity: 0.55; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--sa-primary); flex-shrink: 0;
}
.dot.skipped { background: var(--sa-text-placeholder); }
.label { font-weight: 500; color: var(--sa-text-primary); }
.skip-tag { font-size: 11px; color: var(--sa-text-secondary); }
.duration { font-size: 11px; color: var(--sa-text-secondary); font-family: var(--sa-font-mono); }
.summary { font-size: 12px; color: var(--sa-text-secondary); margin-left: auto; }
</style>
