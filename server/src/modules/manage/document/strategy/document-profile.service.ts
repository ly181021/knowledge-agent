/**
 * DocumentProfileService —— 文档画像 LLM 生成
 * 输入结构节点树（canonicalPath 列表）+ 正文摘要，
 * LLM 输出文档类型 / 主题关键词 / 示例问题，落 DocumentProfile 表。
 * 失败静默跳过（画像非必需，不阻塞 INDEXED）。先删后插保证重投幂等。
 */
import { Injectable, Logger } from '@nestjs/common'
import { generateText } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import { PrismaService } from '@/prisma/prisma.service'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import { extractJson } from './llm-splitter'
import type { StructureNodeData } from './structure-node.builder'

/** LLM 返回的画像结构 */
interface ProfileResult {
  docType?: string
  topics?: string[]
  sampleQuestions?: string[]
}

@Injectable()
export class DocumentProfileService {
  private readonly logger = new Logger(DocumentProfileService.name)

  constructor(
    private llm: LlmService,
    private prisma: PrismaService,
  ) {}

  /**
   * 生成文档画像并落库。
   * @param documentId 文档 id
   * @param nodes 结构节点（提供标题树；为空时只用正文，仍生成画像）
   * @param sampleText 正文（取前 2000 字作摘要）
   */
  async generate(documentId: string, nodes: StructureNodeData[], sampleText: string): Promise<void> {
    try {
      const titleTree = nodes.length > 0
        ? nodes.map((n) => n.canonicalPath).join('\n')
        : '（无结构标题）'
      const prompt = renderPrompt('document-profile', {
        titles: titleTree,
        content: sampleText.slice(0, 2000),
      })
      const { text: raw } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是文档分析助手。只输出 JSON，不要解释。',
        prompt,
      })

      const profile = JSON.parse(extractJson(raw)) as ProfileResult

      // 先删后插（重投幂等）
      await this.prisma.documentProfile.deleteMany({ where: { documentId } })
      await this.prisma.documentProfile.create({
        data: {
          documentId,
          docType: profile.docType ?? null,
          topics: profile.topics ?? undefined,
          sampleQuestions: profile.sampleQuestions ?? undefined,
        },
      })
      this.logger.log(`画像生成成功 doc=${documentId} type=${profile.docType ?? '未知'} topics=${profile.topics?.length ?? 0}`)
    } catch (e) {
      // 画像非必需，失败不阻塞 INDEXED
      this.logger.warn(
        `画像生成失败 doc=${documentId}：${e instanceof Error ? e.message : String(e)}，跳过（不阻塞索引）`,
      )
    }
  }
}
