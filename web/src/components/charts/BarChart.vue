<script setup lang="ts">
/**
 * BarChart —— 柱状图封装（Top10 命中文档）
 * 点击柱体转发为 click emit 供钻取
 */
import { ref, watch, type Ref } from 'vue'
import { useEcharts } from '@/composables/useEcharts'

const props = defineProps<{
  data: { docId: string; docTitle: string; count: number }[]
}>()

const emit = defineEmits<{ click: [{ docId: string; docTitle: string }] }>()

const chartRef = ref<HTMLElement | null>(null)
const option = ref<Record<string, unknown>>({})
const chartInstance = useEcharts(chartRef as Ref<HTMLElement | null>, option)

function buildOption() {
  // 暖色调（与项目主题对齐）
  const TERRA = '#c47b5a'
  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name?: string; data?: { docId?: string; docTitle?: string; value?: number } }[]) => {
        const p = params[0]?.data
        return p ? `${p.docTitle}<br/>命中 ${p.value} 次` : ''
      },
    },
    grid: { left: '15%', right: '8%', bottom: '10%', top: '10%' },
    xAxis: { type: 'category', data: props.data.map((d) => d.docTitle.length > 8 ? d.docTitle.slice(0, 8) + '…' : d.docTitle), axisLabel: { rotate: 30, color: '#6b6258' }, axisLine: { lineStyle: { color: '#d4cab8' } } },
    yAxis: { type: 'value', name: '命中次数', axisLabel: { color: '#6b6258' }, splitLine: { lineStyle: { color: '#ece5d8' } }, nameTextStyle: { color: '#6b6258' } },
    series: [{
      type: 'bar',
      data: props.data.map((d) => ({ value: d.count, docId: d.docId, docTitle: d.docTitle })),
      itemStyle: { color: TERRA, borderRadius: [4, 4, 0, 0] },
    }],
  }
}

watch(() => props.data, buildOption, { immediate: true, deep: true })

// 绑定 ECharts 点击事件，转发为组件 click emit
watch(chartInstance, (c) => {
  if (!c) return
  c.off('click')
  c.on('click', (params) => {
    const data = params?.data as { docId?: string; docTitle?: string } | undefined
    if (data?.docId) {
      emit('click', { docId: data.docId, docTitle: data.docTitle ?? '' })
    }
  })
}, { immediate: true })
</script>

<template>
  <div class="chart-wrap">
    <div ref="chartRef" data-test="bar-chart" style="width: 100%; height: 300px" />
    <!-- 空数据时空坐标系无意义，覆盖空态提示；画布保留以保证 ECharts 初始化尺寸 -->
    <div v-if="data.length === 0" class="chart-empty">
      <el-empty description="暂无命中数据" :image-size="80" />
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
