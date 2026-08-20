<script setup lang="ts">
/**
 * PieChart —— 饼图封装（执行模式占比）
 */
import { ref, watch, type Ref } from 'vue'
import { useEcharts } from '@/composables/useEcharts'

const props = defineProps<{
  data: { mode: string; count: number }[]
}>()

const chartRef = ref<HTMLElement | null>(null)
const option = ref<Record<string, unknown>>({})

function buildOption() {
  // 暖色调色板（陶土/沙/琥珀/雾灰），与项目主题一致，避免冷色蓝绿
  const palette = ['#c47b5a', '#b8a080', '#e8a87c', '#8a9a8e', '#d4a085']
  option.value = {
    color: palette,
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left', textStyle: { color: '#6b6258' } },
    series: [
      {
        type: 'pie',
        radius: '60%',
        data: props.data.map((d) => ({ name: d.mode, value: d.count })),
        // ECharts 渲染于 Canvas，不解析 CSS 变量；色值须为实色
        itemStyle: { borderRadius: 6, borderColor: '#ffffff', borderWidth: 2 },
        label: { color: '#6b6258' },
      },
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
      <el-empty description="暂无执行数据" :image-size="80" />
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
