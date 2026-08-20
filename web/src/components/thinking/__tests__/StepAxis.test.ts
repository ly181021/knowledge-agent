import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StepAxis from '../StepAxis.vue'
import type { ThinkingStep, PrepareStep } from '@/types/thinking'

function makeStep(step: PrepareStep, overrides: Record<string, unknown> = {}): ThinkingStep {
  return { step, ts: 0, payload: overrides }
}

describe('StepAxis', () => {
  it('渲染所有步骤节点', () => {
    const steps = [
      makeStep('rewrite', { skipped: false, durationMs: 120 }),
      makeStep('retrieval', { skipped: false }),
    ]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 0 } })
    expect(wrapper.findAll('[data-test="axis-node"]')).toHaveLength(2)
  })

  it('currentIndex 之前的节点为 done 态', () => {
    const steps = [makeStep('rewrite'), makeStep('retrieval'), makeStep('route')]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 2 } })
    const nodes = wrapper.findAll('[data-test="axis-node"]')
    expect(nodes[0]!.classes()).toContain('done')
    expect(nodes[1]!.classes()).toContain('done')
  })

  it('currentIndex 节点为 active 态', () => {
    const steps = [makeStep('rewrite'), makeStep('retrieval')]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 1 } })
    const nodes = wrapper.findAll('[data-test="axis-node"]')
    expect(nodes[1]!.classes()).toContain('active')
  })

  it('currentIndex 之后的节点为 todo 态', () => {
    const steps = [makeStep('rewrite'), makeStep('retrieval'), makeStep('route')]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 0 } })
    const nodes = wrapper.findAll('[data-test="axis-node"]')
    expect(nodes[1]!.classes()).toContain('todo')
    expect(nodes[2]!.classes()).toContain('todo')
  })

  it('skipped 步骤为 skipped 态（不论 currentIndex）', () => {
    const steps = [
      makeStep('rewrite', { skipped: false }),
      makeStep('subQuestion', { skipped: true }),
      makeStep('retrieval', { skipped: false }),
    ]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 2 } })
    const nodes = wrapper.findAll('[data-test="axis-node"]')
    expect(nodes[1]!.classes()).toContain('skipped')
  })

  it('finished=true 时所有非 skipped 节点为 done（无 active）', () => {
    const steps = [makeStep('rewrite'), makeStep('retrieval')]
    const wrapper = mount(StepAxis, { props: { steps, currentIndex: 2, finished: true } })
    const nodes = wrapper.findAll('[data-test="axis-node"]')
    expect(nodes[0]!.classes()).toContain('done')
    expect(nodes[1]!.classes()).toContain('done')
    expect(nodes.some((n) => n.classes().includes('active'))).toBe(false)
  })

  it('空 steps 数组渲染零节点', () => {
    const wrapper = mount(StepAxis, { props: { steps: [], currentIndex: 0 } })
    expect(wrapper.findAll('[data-test="axis-node"]')).toHaveLength(0)
  })
})
