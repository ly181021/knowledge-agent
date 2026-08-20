/**
 * HeadingDisambiguator 单测 —— 低置信标题 LLM 判歧
 * 覆盖 5 个分支：
 * - 候选空（全正则/冒号命中）→ 不调 LLM
 * - 候选 <3 → 不调 LLM
 * - 判歧剔除（LLM 返回 isHeading=false）→ 对应行被过滤
 * - 全部保留（LLM 返回全 true）→ 原样返回
 * - LLM 失败回退（generateText reject）→ 保留全部候选
 * 风格：jest.mock('ai') 拦截 generateText + mock LlmService/ConfigService/renderPrompt。
 */
import { generateText } from 'ai'
import { HeadingDisambiguator } from './heading-disambiguator'
import type { HeadingLine } from './heading-detector'

// 拦截 ai 包的 generateText（jest.mock 提升到顶部，工厂内不能引用外部变量，用 jest.fn 占位）
jest.mock('ai', () => ({
  generateText: jest.fn(),
}))
const mockGenerateText = jest.mocked(generateText)

// 拦截 renderPrompt（避免读真实 .md 文件）
jest.mock('@/modules/chatagent/prompts/render', () => ({
  renderPrompt: jest.fn(() => 'mock-prompt'),
}))

/** 构造 HeadingLine */
const mk = (lineNo: number, confidence: number, text = `line-${lineNo}`): HeadingLine => ({
  lineNo,
  level: 1,
  text,
  pattern: confidence >= 1 ? 'markdown' : confidence >= 0.6 ? 'plain-heading-colon' : 'plain-heading',
  confidence,
})

/** 构造 mock 依赖 */
function makeMocks() {
  return {
    llm: { getChatModel: jest.fn(() => 'mock-model') },
  }
}

function makeDisambiguator(m: ReturnType<typeof makeMocks>) {
  return new HeadingDisambiguator(m.llm as never)
}

describe('HeadingDisambiguator', () => {
  let m: ReturnType<typeof makeMocks>
  let disambiguator: HeadingDisambiguator

  beforeEach(() => {
    m = makeMocks()
    disambiguator = makeDisambiguator(m)
    mockGenerateText.mockReset()
  })

  it('候选空（全正则/冒号命中）→ 不调 LLM，原样返回', async () => {
    const headings = [mk(0, 1.0), mk(5, 0.7)] // 正则 1.0 + 冒号 0.7，无 <0.6 候选

    const result = await disambiguator.disambiguate(headings, ['line0', '', '', '', '', 'line5'])

    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(result).toBe(headings) // 原样返回（同一引用）
  })

  it('候选 <3 → 不调 LLM，原样返回', async () => {
    const headings = [mk(0, 1.0), mk(2, 0.58), mk(5, 0.58)] // 只有 2 个 <0.6 候选

    const result = await disambiguator.disambiguate(headings, [])

    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(result).toBe(headings)
  })

  it('判歧剔除：LLM 返回 isHeading=false 的行被过滤', async () => {
    const headings = [mk(0, 1.0), mk(2, 0.58), mk(4, 0.58), mk(6, 0.58)] // 3 个 <0.6 候选
    // LLM 判 lineNo=4 不是标题（as never：generateText 返回 GenerateTextResult 多字段，mock 只给 text）
    mockGenerateText.mockResolvedValue({ text: '[{"lineNo":2,"isHeading":true},{"lineNo":4,"isHeading":false},{"lineNo":6,"isHeading":true}]' } as never)

    const result = await disambiguator.disambiguate(headings, [])

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(result.map((h) => h.lineNo)).toEqual([0, 2, 6]) // lineNo=4 被剔除
  })

  it('全部保留：LLM 返回全 true → 原样返回', async () => {
    const headings = [mk(0, 0.58), mk(2, 0.58), mk(4, 0.58)]
    mockGenerateText.mockResolvedValue({ text: '[{"lineNo":0,"isHeading":true},{"lineNo":2,"isHeading":true},{"lineNo":4,"isHeading":true}]' } as never)

    const result = await disambiguator.disambiguate(headings, [])

    expect(result.map((h) => h.lineNo)).toEqual([0, 2, 4]) // 全保留
  })

  it('LLM 失败回退：generateText reject → 保留全部候选', async () => {
    const headings = [mk(0, 0.58), mk(2, 0.58), mk(4, 0.58)]
    mockGenerateText.mockRejectedValue(new Error('LLM 服务不可用'))

    const result = await disambiguator.disambiguate(headings, [])

    expect(result).toBe(headings) // 失败回退，原样返回
  })
})
