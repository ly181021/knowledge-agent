/**
 * DocumentProfileService 单测 —— 文档画像
 * 覆盖：
 * - LLM 正常返回 → 先删后插落库
 * - LLM 失败 → 静默跳过（不抛错，不落库）
 * - nodes 为空 → 仍调用（只用正文）
 */
import { generateText } from 'ai'
import { DocumentProfileService } from './document-profile.service'
import type { StructureNodeData } from './structure-node.builder'

// 拦截 ai 包
jest.mock('ai', () => ({ generateText: jest.fn() }))
const mockGenerateText = jest.mocked(generateText)

// 拦截 renderPrompt
jest.mock('@/modules/chatagent/prompts/render', () => ({
  renderPrompt: jest.fn(() => 'mock-prompt'),
}))

function makeMocks() {
  return {
    llm: { getChatModel: jest.fn(() => 'mock-model') },
    prisma: {
      documentProfile: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    },
  }
}

function makeService(m: ReturnType<typeof makeMocks>) {
  return new DocumentProfileService(m.llm as never, m.prisma as never)
}

const nodes: StructureNodeData[] = [
  { nodeNo: 0, parentId: null, level: 1, title: '产品手册', content: '...', canonicalPath: '产品手册', lineNo: 0, confidence: 1 },
  { nodeNo: 1, parentId: 'id-0', level: 2, title: '安装', content: '...', canonicalPath: '产品手册>安装', lineNo: 2, confidence: 1 },
]

describe('DocumentProfileService', () => {
  let m: ReturnType<typeof makeMocks>
  let service: DocumentProfileService

  beforeEach(() => {
    m = makeMocks()
    service = makeService(m)
    mockGenerateText.mockReset()
  })

  it('LLM 正常返回 → 先删后插落库', async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"docType":"手册","topics":["安装","配置"],"sampleQuestions":["如何安装？"]}',
    } as never)

    await service.generate('doc-1', nodes, '正文内容')

    expect(m.prisma.documentProfile.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } })
    expect(m.prisma.documentProfile.create).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-1',
        docType: '手册',
        topics: ['安装', '配置'],
        sampleQuestions: ['如何安装？'],
      },
    })
  })

  it('LLM 失败 → 静默跳过（不抛错，不落库）', async () => {
    mockGenerateText.mockRejectedValue(new Error('LLM 不可用'))

    // 不应抛错
    await expect(service.generate('doc-1', nodes, '正文')).resolves.toBeUndefined()

    // 没落库（deleteMany 可能被调，但 create 不应被调——因为 catch 在 generateText 抛错时就进了）
    expect(m.prisma.documentProfile.create).not.toHaveBeenCalled()
  })

  it('nodes 为空 → 仍调用 LLM（只用正文）', async () => {
    mockGenerateText.mockResolvedValue({ text: '{"docType":"报告"}' } as never)

    await service.generate('doc-1', [], '只有正文没有标题')

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(m.prisma.documentProfile.create).toHaveBeenCalled()
  })
})
