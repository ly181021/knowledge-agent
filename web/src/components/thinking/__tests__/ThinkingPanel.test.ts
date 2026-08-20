import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkingPanel from '../ThinkingPanel.vue'
import type { ThinkingTrace } from '@/types/thinking'

describe('ThinkingPanel', () => {
  const trace: ThinkingTrace = {
    messageId: 'm1',
    frozen: false,
    steps: [
      { step: 'rewrite', ts: 1, payload: { from: 'a', to: 'b', skipped: false } },
      { step: 'route', ts: 2, payload: { mode: 'RETRIEVAL' } },
    ],
  }

  it('无 trace 时显示空态且不报错', () => {
    const wrapper = mount(ThinkingPanel, { props: { trace: null, collapsed: false } })
    expect(wrapper.text()).toContain('本次无思考过程')
  })

  it('传入 trace 时渲染标题与内容', () => {
    const wrapper = mount(ThinkingPanel, { props: { trace, collapsed: false } })
    expect(wrapper.text()).toContain('思考过程')
    expect(wrapper.text()).toContain('改写问题')
  })

  it('点击切换按钮触发 toggle 事件', async () => {
    const wrapper = mount(ThinkingPanel, { props: { trace, collapsed: false } })
    await wrapper.find('[data-test="toggle-btn"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeTruthy()
  })
})
