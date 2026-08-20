/**
 * HeadingDetector 单测
 * 覆盖：
 * - 正则命中 ≥2 早退（不启用启发式）
 * - 频次 ≥3 判页眉页脚噪声过滤
 * - 冒号特征触发（冒号标签行 + 短孤立下行 → confidence 0.7）
 * - 纯启发式（孤立短行 → confidence 0.58）
 * - looksLikePlainHeading 门（含标点/列表项不识别）
 */
import { HeadingDetector } from './heading-detector'

describe('HeadingDetector', () => {
  it('Markdown #/## 正则命中 → confidence 1.0，level 按 # 数', () => {
    const text = ['# 标题一', '正文。', '## 子标题', '正文二。'].join('\n')
    const result = HeadingDetector.detect(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ level: 1, text: '标题一', confidence: 1.0, pattern: 'markdown' })
    expect(result[1]).toMatchObject({ level: 2, text: '子标题', confidence: 1.0 })
  })

  it('正则命中 ≥2 → 早退，不启用启发式', () => {
    // 两个 # 标题 + 一个孤立短行（启发式候选，但应被早退跳过）
    const text = ['# A', 'x', '# B', '孤立短行'].join('\n')
    const result = HeadingDetector.detect(text)
    expect(result).toHaveLength(2) // 只有 2 个正则，启发式的孤立短行不进
    expect(result.every((r) => r.confidence === 1.0)).toBe(true)
  })

  it('频次 ≥3 的行被判为页眉页脚噪声过滤', () => {
    // 公司机密行高频重复模拟页眉，加 2 个正则标题触发结构
    const header = '公司机密'
    const text = ['# 文档', header, header, header, '# 第二章', header, header, header].join('\n')
    const result = HeadingDetector.detect(text)
    // 公司机密频次 ≥3 → 即使满足启发式条件也不识别为标题
    expect(result.find((r) => r.text === header)).toBeUndefined()
  })

  it('冒号特征触发：上行"第一章："→ 下行 confidence 0.7（原 bug 导致恒 false）', () => {
    // 冒号标签行 + 短孤立下行（无空行间隔，模拟第一章：与总则相邻两行）
    // 注意：只有 0 个正则命中时启发式才启用（< 2），这里故意不加 # 让启发式跑
    const text = ['第一章：', '总则', '', '这是正文内容描述。'].join('\n')
    const result = HeadingDetector.detect(text)
    const heading = result.find((r) => r.text === '总则')
    expect(heading).toBeDefined()
    expect(heading!.confidence).toBe(0.7)
    expect(heading!.pattern).toBe('plain-heading-colon')
  })

  it('纯启发式：孤立短行（前后空行）→ confidence 0.58', () => {
    // 无正则标题，一个孤立短行触发启发式
    const text = ['这是较长的正文段落用于占位避免被识别。', '', '总则', '', '另一段正文内容描述。'].join('\n')
    const result = HeadingDetector.detect(text)
    const heading = result.find((r) => r.text === '总则')
    expect(heading).toBeDefined()
    expect(heading!.confidence).toBe(0.58)
    expect(heading!.pattern).toBe('plain-heading')
  })

  it('looksLikePlainHeading 门：含标点/列表项不识别', () => {
    // 孤立行但含句号 → 不是标题
    const text = ['', '这是一个完整的句子。', '', '正文'].join('\n')
    const result = HeadingDetector.detect(text)
    expect(result.find((r) => r.text === '这是一个完整的句子。')).toBeUndefined()
  })
})
