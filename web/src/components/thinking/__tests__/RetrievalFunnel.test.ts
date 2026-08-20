import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RetrievalFunnel from '../../RetrievalFunnel.vue'
import type { ThinkingStep } from '@/types/thinking'

describe('RetrievalFunnel', () => {
  const retrievalStep: ThinkingStep = {
    step: 'retrieval',
    ts: 1000,
    payload: {
      channels: [
        { name: 'vector', recalled: 8, accepted: 3, durationMs: 50 },
        { name: 'keyword', recalled: 5, accepted: 2, durationMs: 30 },
      ],
      fusedCount: 10,
      topK: 3,
    },
  }

  it('渲染每个通道的召回/入选', () => {
    const wrapper = mount(RetrievalFunnel, { props: { steps: [retrievalStep] } })
    const text = wrapper.text()
    expect(text).toContain('向量')
    expect(text).toContain('关键词')
    expect(text).toContain('8')
    expect(text).toContain('3')
  })

  it('显示融合数和最终入选数', () => {
    const wrapper = mount(RetrievalFunnel, { props: { steps: [retrievalStep] } })
    const text = wrapper.text()
    expect(text).toContain('10')  // fusedCount
    expect(text).toContain('3')   // topK
  })

  it('无 retrieval 步骤时不渲染', () => {
    const wrapper = mount(RetrievalFunnel, {
      props: { steps: [{ step: 'rewrite', ts: 1, payload: {} }] },
    })
    expect(wrapper.find('[data-test="funnel"]').exists()).toBe(false)
  })
})
