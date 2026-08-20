import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BarChart from '../BarChart.vue'

describe('BarChart', () => {
  it('props 含 docTitle 时不报错（数据结构校验）', () => {
    const wrapper = mount(BarChart, {
      props: {
        data: [
          { docId: 'd1', docTitle: '产品手册.pdf', count: 3 },
          { docId: 'd2', docTitle: 'FAQ.docx', count: 1 },
        ],
      },
    })
    expect(wrapper.find('[data-test="bar-chart"]').exists()).toBe(true)
  })

  it('空数据也能挂载不报错', () => {
    const wrapper = mount(BarChart, { props: { data: [] } })
    expect(wrapper.exists()).toBe(true)
  })
})
