/**
 * useEcharts —— ECharts 按需引入 + ResizeObserver 自适应
 * 返回 chart 实例供组件绑定事件
 */
import { onMounted, onBeforeUnmount, watch, ref, type Ref } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

export function useEcharts(el: Ref<HTMLElement | null>, option: Ref<Record<string, unknown>>) {
  let chart: echarts.ECharts | null = null
  let ro: ResizeObserver | null = null
  const chartRef = ref<echarts.ECharts | null>(null)

  onMounted(() => {
    if (!el.value) return
    chart = echarts.init(el.value)
    chart.setOption(option.value)
    chartRef.value = chart
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(el.value)
  })

  watch(option, (v) => chart?.setOption(v, true), { deep: true })

  onBeforeUnmount(() => {
    chart?.dispose()
    ro?.disconnect()
  })

  return chartRef
}
