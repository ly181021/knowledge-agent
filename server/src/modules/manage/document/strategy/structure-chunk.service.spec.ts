import { StructureChunkService } from './structure-chunk.service'
import type { HeadingLine } from './heading-detector'

/** mock disambiguator：透传原数组（判歧逻辑在 heading-disambiguator.spec.ts 单独测） */
const mockDisambiguator = {
  disambiguate: jest.fn(async (headings: HeadingLine[]) => headings),
}

describe('StructureChunkService', () => {
  let svc: StructureChunkService

  beforeEach(() => {
    mockDisambiguator.disambiguate.mockClear()
    svc = new StructureChunkService(mockDisambiguator as never)
  })

  it('Markdown #/## 标题 → 按章节切，headingPath 正确嵌套', async () => {
    const text = [
      '# 产品手册',
      '这是产品总览。',
      '## 安装',
      '安装步骤如下。',
      '## 使用',
      '使用方法说明。',
    ].join('\n')

    const { chunks } = await svc.split(text)

    // 应该按标题切成多块，且 headingPath 正确
    expect(chunks.length).toBeGreaterThan(2)
    const installChunk = chunks.find((c) => c.content.includes('安装步骤'))
    expect(installChunk?.headingPath).toEqual(['产品手册', '安装'])
    const usageChunk = chunks.find((c) => c.content.includes('使用方法'))
    expect(usageChunk?.headingPath).toEqual(['产品手册', '使用'])
  })

  it('数字编号 1.1/1.2 → 按编号切', async () => {
    const text = ['1.1 环境要求', '需要 Node 20。', '1.2 启动方式', '执行 npm start。'].join('\n')

    const { chunks } = await svc.split(text)

    const envChunk = chunks.find((c) => c.content.includes('Node 20'))
    expect(envChunk?.headingPath).toEqual(['环境要求'])
    const startChunk = chunks.find((c) => c.content.includes('npm start'))
    expect(startChunk?.headingPath).toEqual(['启动方式'])
  })

  it('中文「第一章」/「一、」标题 → 按中文标题切', async () => {
    const text = ['第一章 概述', '本产品用于企业知识问答。', '第二章 安装', '安装步骤说明。'].join('\n')

    const { chunks } = await svc.split(text)

    const ch1 = chunks.find((c) => c.content.includes('企业知识问答'))
    expect(ch1?.headingPath?.some((h) => h.includes('第一章'))).toBe(true)
  })

  it('无标题纯文本 → 回退递归兜底，headingPath 为空', async () => {
    // 足够长（>800字）且带换行，保证递归切出多块；无任何标题标记
    const text = Array.from({ length: 40 }, (_, i) => `这是第 ${i} 段没有标题标记的普通正文内容。`).join('\n\n')

    const { chunks } = await svc.split(text)

    // 无标题 → 所有 chunk 都不带 headingPath
    expect(chunks.every((c) => c.headingPath === undefined)).toBe(true)
    expect(chunks.length).toBeGreaterThan(1) // 递归切成多块
  })

  it('超长章节（>800字）→ 内部语义细分，子块继承 headingPath', async () => {
    const longBody = '这是该章节的详细说明内容。'.repeat(100) // 远超 800 字
    const text = ['# 手册', '# 详细章节', longBody].join('\n')

    const { chunks } = await svc.split(text)

    // 详细章节被切成多块，都继承同一个 headingPath
    const detailChunks = chunks.filter((c) => c.headingPath?.includes('详细章节'))
    expect(detailChunks.length).toBeGreaterThan(1)
    // 子块 headingPath 一致
    const firstPath = JSON.stringify(detailChunks[0].headingPath)
    expect(detailChunks.every((c) => JSON.stringify(c.headingPath) === firstPath)).toBe(true)
  })

  it('文档开头有正文（第一个标题前）→ 单独成块 headingPath 含「文档开头」', async () => {
    // 给足 2 个标题触发结构切块，开头正文单独成块
    const text = ['这是文档开头的引言部分，不归属任何章节。', '', '# 第一章', '正文内容一。', '# 第二章', '正文内容二。'].join('\n')

    const { chunks } = await svc.split(text)

    const preface = chunks.find((c) => c.content.includes('引言部分'))
    expect(preface?.headingPath).toEqual(['（文档开头）'])
  })

  it('多级标题层级栈（# 下有 ##）→ headingPath 正确嵌套', async () => {
    const text = [
      '# 产品',
      '总览',
      '## 安装',
      '安装说明',
      '## 使用',
      '使用说明',
    ].join('\n')

    const { chunks } = await svc.split(text)
    const installChunk = chunks.find((c) => c.content.includes('安装说明'))
    // ## 安装 的 headingPath 应包含父级 # 产品 + 当前 ##
    expect(installChunk?.headingPath).toEqual(['产品', '安装'])
  })
})
