import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StepTimeline from '../../StepTimeline.vue'
import type { ThinkingStep } from '@/types/thinking'

describe('StepTimeline', () => {
  const steps: ThinkingStep[] = [
    { step: 'rewrite', ts: 1000, payload: { from: 'a', to: 'b', skipped: false } },
    { step: 'route', ts: 1001, payload: { mode: 'RETRIEVAL' } },
  ]

  it('渲染所有步骤', () => {
    const wrapper = mount(StepTimeline, { props: { steps } })
    const items = wrapper.findAll('[data-test="step-item"]')
    expect(items).toHaveLength(2)
  })

  it('显示步骤中文名', () => {
    const wrapper = mount(StepTimeline, { props: { steps } })
    expect(wrapper.text()).toContain('改写问题')
    expect(wrapper.text()).toContain('路由判定')
  })

  it('skipped 步骤带跳过标记', () => {
    const skippedSteps: ThinkingStep[] = [
      { step: 'scopeShrink', ts: 1000, payload: { skipped: true } },
    ]
    const wrapper = mount(StepTimeline, { props: { steps: skippedSteps } })
    expect(wrapper.text()).toContain('已跳过')
  })

  it('空 steps 显示空态', () => {
    const wrapper = mount(StepTimeline, { props: { steps: [] } })
    expect(wrapper.text()).toContain('暂无思考过程')
  })
})
