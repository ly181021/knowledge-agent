/**
 * structure-node.builder 单测 —— 结构节点树构建
 * 覆盖：
 * - 空标题 → 空数组
 * - 单层标题 → parentId 全 null
 * - 多层标题 → 父子链正确（栈式弹压）
 * - canonicalPath 拼接（以 > 分隔）
 * - 正文切片（标题行→下一标题行）
 */
import { buildStructureNodes } from './structure-node.builder'
import type { HeadingLine } from './heading-detector'

const mk = (lineNo: number, level: number, text: string, confidence = 1.0): HeadingLine => ({
  lineNo,
  level,
  text,
  pattern: 'markdown',
  confidence,
})

describe('buildStructureNodes', () => {
  it('空标题 → 空数组', () => {
    expect(buildStructureNodes([], '任何文本')).toEqual([])
  })

  it('单层标题 → parentId 全 null，canonicalPath = 标题本身', () => {
    const text = ['概述', '内容一。', '安装', '内容二。'].join('\n')
    const headings = [mk(0, 1, '概述'), mk(2, 1, '安装')]

    const nodes = buildStructureNodes(headings, text)

    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ parentId: null, level: 1, title: '概述', canonicalPath: '概述' })
    expect(nodes[1]).toMatchObject({ parentId: null, level: 1, title: '安装', canonicalPath: '安装' })
  })

  it('多层标题 → 父子链正确（## 的 parent 是上一个 #）', () => {
    const text = ['# 产品', '总览', '## 安装', '步骤', '## 使用', '说明'].join('\n')
    const headings = [mk(0, 1, '产品'), mk(2, 2, '安装'), mk(4, 2, '使用')]

    const nodes = buildStructureNodes(headings, text)

    expect(nodes).toHaveLength(3)
    // 产品（level 1，无父）
    expect(nodes[0].parentId).toBeNull()
    expect(nodes[0].canonicalPath).toBe('产品')
    // 安装（level 2，有父——parentId 指向产品的 uuid，内存结构无 id 字段，验证非空即可）
    expect(nodes[1].parentId).not.toBeNull()
    expect(nodes[1].level).toBe(2)
    expect(nodes[1].canonicalPath).toBe('产品>安装')
    // 使用（level 2，父=产品——安装已弹栈）
    expect(nodes[2].canonicalPath).toBe('产品>使用')
  })

  it('canonicalPath 三层嵌套（# > ## > ###）', () => {
    const text = ['# A', '', '## B', '', '### C', '内容'].join('\n')
    const headings = [mk(0, 1, 'A'), mk(2, 2, 'B'), mk(4, 3, 'C')]

    const nodes = buildStructureNodes(headings, text)

    expect(nodes[2].canonicalPath).toBe('A>B>C')
    expect(nodes[2].level).toBe(3)
  })

  it('正文切片：标题行→下一标题行', () => {
    const text = ['标题一', '这是正文。', '第二行。', '标题二', '另一段。'].join('\n')
    const headings = [mk(0, 1, '标题一'), mk(3, 1, '标题二')]

    const nodes = buildStructureNodes(headings, text)

    // 标题一的正文 = 行 0-2（标题一 / 这是正文。/ 第二行。）
    expect(nodes[0].content).toContain('这是正文。')
    expect(nodes[0].content).toContain('第二行。')
    expect(nodes[0].content).toContain('标题一')
    // 标题二的正文 = 行 3-4
    expect(nodes[1].content).toContain('另一段。')
  })

  it('nodeNo 从 0 递增', () => {
    const text = ['A', 'x', 'B', 'x', 'C', 'x'].join('\n')
    const headings = [mk(0, 1, 'A'), mk(2, 1, 'B'), mk(4, 1, 'C')]

    const nodes = buildStructureNodes(headings, text)

    expect(nodes.map((n) => n.nodeNo)).toEqual([0, 1, 2])
  })
})
