<script setup lang="ts">
/**
 * RetrievalFunnel —— 检索漏斗
 * vector 召回 → keyword 召回 → RRF 融合 → topK 入选
 * 条形宽度按各阶段数量比例渐窄
 */
import { computed } from 'vue'
import type { ThinkingStep } from '@/types/thinking'

const props = defineProps<{ steps: ThinkingStep[] }>()

interface FunnelRow {
  label: string
  count: number
  widthPct: number
}
interface FunnelData {
  channels: FunnelRow[]
  fusedCount: number
  topK: number
  fusedWidth: number
  topKWidth: number
}

const CHANNEL_LABEL: Record<string, string> = {
  vector: '向量',
  keyword: '关键词',
}

const data = computed<FunnelData | null>(() => {
  const retrievalStep = props.steps.find((s) => s.step === 'retrieval')
  if (!retrievalStep) return null
  const p = retrievalStep.payload
  const channelsRaw = (p.channels as { name: string; recalled: number; accepted: number }[] | undefined) ?? []
  const fusedCount = typeof p.fusedCount === 'number' ? p.fusedCount : 0
  const topK = typeof p.topK === 'number' ? p.topK : 0
  const max = Math.max(...channelsRaw.map((c) => c.recalled), fusedCount, topK, 1)

  const channels: FunnelRow[] = channelsRaw.map((c) => ({
    label: CHANNEL_LABEL[c.name] ?? c.name,
    count: c.recalled,
    widthPct: Math.round((c.recalled / max) * 100),
  }))

  return {
    channels,
    fusedCount,
    topK,
    fusedWidth: Math.round((fusedCount / max) * 100),
    topKWidth: Math.round((topK / max) * 100),
  }
})
</script>

<template>
  <div v-if="data" class="funnel" data-test="funnel">
    <div class="funnel-title">检索漏斗</div>
    <div class="funnel-stage">
      <div v-for="(ch, i) in data.channels" :key="i" class="bar-row">
        <span class="bar-label">{{ ch.label }}召回</span>
        <div class="bar-track">
          <div class="bar-fill" :style="{ width: ch.widthPct + '%' }"></div>
        </div>
        <span class="bar-count">{{ ch.count }}</span>
      </div>
    </div>
    <div class="funnel-arrow" aria-hidden="true">↓</div>
    <div class="funnel-stage">
      <div class="bar-row">
        <span class="bar-label">RRF 融合</span>
        <div class="bar-track">
          <div class="bar-fill bar-fused" :style="{ width: data.fusedWidth + '%' }"></div>
        </div>
        <span class="bar-count">{{ data.fusedCount }}</span>
      </div>
    </div>
    <div class="funnel-arrow" aria-hidden="true">↓</div>
    <div class="funnel-stage">
      <div class="bar-row">
        <span class="bar-label">最终入选</span>
        <div class="bar-track">
          <div class="bar-fill bar-topk" :style="{ width: data.topKWidth + '%' }"></div>
        </div>
        <span class="bar-count">{{ data.topK }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.funnel { margin-top: 12px; padding: 12px; background: var(--sa-bg-sidebar); border-radius: var(--sa-radius-sm); }
.funnel-title { font-size: 12px; color: var(--sa-text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
.funnel-stage { display: flex; flex-direction: column; gap: 4px; }
.bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.bar-label { min-width: 64px; color: var(--sa-text-regular); }
.bar-track { flex: 1; height: 14px; background: var(--sa-bg-hover); border-radius: 7px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--sa-chart-secondary); border-radius: 7px; transition: width 0.4s ease; }
.bar-fused { background: var(--sa-chart-tertiary); }
.bar-topk { background: var(--sa-primary); }
.bar-count { min-width: 24px; text-align: right; font-family: var(--sa-font-mono); color: var(--sa-text-primary); font-weight: 600; }
.funnel-arrow { text-align: center; color: var(--sa-text-placeholder); font-size: 12px; margin: 2px 0; }
@media (prefers-reduced-motion: reduce) { .bar-fill { transition: none; } }
</style>
