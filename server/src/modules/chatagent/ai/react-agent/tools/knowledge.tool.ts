/**
 * knowledge.tool.ts —— 知识库检索工具（ReAct 工具 1/2）
 * 复用 RagService.retrieve（全库检索），把检索结果截断成 snippet 返回给模型。
 */
import { z } from 'zod'
import type { RagService } from '@/modules/chatagent/rag/rag.service'

export function createKnowledgeTools(rag: RagService) {
  return {
    knowledgeSearch: {
      description: '在企业知识库中检索相关文档片段。当问题涉及公司政策、产品、流程、文档内容、内部资料时使用。',
      parameters: z.object({ query: z.string().describe('检索关键词或问题') }),
      execute: async ({ query }: { query: string }) => {
        // RagResult.citations 含 content（ChunkScore 无 content，只用于 trace）
        const { citations } = await rag.retrieve(query)
        return {
          count: citations.length,
          snippets: citations.map((c) => c.content.slice(0, 200)),
        }
      },
    },
  }
}
