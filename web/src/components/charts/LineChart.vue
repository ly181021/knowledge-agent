<script setup lang="ts">
/**
 * LineChart —— 折线图封装（Token/QPS 趋势）
 */
import { ref, watch, type Ref } from 'vue'
import { useEcharts } from '@/composables/useEcharts'

const props = defineProps<{
  data: { date: string; tokens: number; qps: number }[]
}>()

const chartRef = ref<HTMLElement | null>(null)
const option = ref<Record<string, unknown>>({})

function buildOption() {
  // 暖色调色板（与项目 theme 对齐，避免冷色蓝绿）
  const TERRA = '#c47b5a'
  const AMBER = '#b8a080'
  option.value = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Token 消耗', 'QPS'], textStyle: { color: '#6b6258' } },
    grid: { left: '8%', right: '8%', bottom: '10%', top: '15%' },
    xAxis: { type: 'category', data: props.data.map((d) => d.date), axisLine: { lineStyle: { color: '#d4cab8' } }, axisLabel: { color: '#6b6258' } },
    yAxis: [
      { type: 'value', name: 'Token', splitLine: { lineStyle: { color: '#ece5d8' } }, axisLabel: { color: '#6b6258' }, nameTextStyle: { color: '#6b6258' } },
      { type: 'value', name: 'QPS', splitLine: { show: false }, axisLabel: { color: '#6b6258' }, nameTextStyle: { color: '#6b6258' } },
    ],
    series: [
      { name: 'Token 消耗', type: 'line', data: props.data.map((d) => d.tokens), smooth: true, itemStyle: { color: TERRA }, lineStyle: { color: TERRA }, areaStyle: { color: 'rgba(196,123,90,0.08)' } },
      { name: 'QPS', type: 'line', yAxisIndex: 1, data: props.data.map((d) => d.qps), smooth: true, itemStyle: { color: AMBER }, lineStyle: { color: AMBER } },
    ],
  }
}

watch(() => props.data, buildOption, { immediate: true, deep: true })

useEcharts(chartRef as Ref<HTMLElement | null>, option)
</script>

<template>
  <div class="chart-wrap">
    <div ref="chartRef" style="width: 100%; height: 300px" />
    <!-- 空数据时空坐标系无意义，覆盖空态提示；画布保留以保证 ECharts 初始化尺寸 -->
    <div v-if="data.length === 0" class="chart-empty">
      <el-empty description="暂无使用数据" :image-size="80" />
    </div>
  </div>
</template>

<style scoped>
.chart-wrap {
  position: relative;
}
.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sa-bg-card);
}
</style>
