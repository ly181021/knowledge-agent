/**
 * VectorChannel —— 向量检索通道
 * 用 embedding model 把 question 转向量，pgvector cosine 查 topK
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { embed } from 'ai'
import { LlmService } from '@/modules/infra/llm.provider'
import type { RetrievalChannel, RetrievalResult } from './retrieval-channel'

@Injectable()
export class VectorChannel implements RetrievalChannel {
  private readonly logger = new Logger(VectorChannel.name)
  private readonly pgUrl: string

  constructor(
    private llm: LlmService,
    private config: ConfigService,
  ) {
    this.pgUrl = this.config.get<string>('PG_URL', 'postgresql://knowledgeagent:knowledgeagent123@localhost:5432/knowledgeagent')
  }

  async retrieve(question: string, topK = 8, filterDocIds?: string[]): Promise<RetrievalResult[]> {
    // 1. 问题转向量
    const { embedding } = await embed({
      model: this.llm.getEmbeddingModel(),
      value: question,
    })

    // 2. pgvector cosine 查询 topK
    //    filterDocIds 非空时限定文档范围（当前文档问答模式），参数化防注入
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const hasDocFilter = filterDocIds && filterDocIds.length > 0
      // document_id 是 uuid 列，参数数组必须 cast uuid[]（否则报 operator does not exist: uuid = text）
      const query = hasDocFilter
        ? `SELECT id, document_id, chunk_index, content,
                  1 - (embedding <=> $1::vector) AS similarity
           FROM document_chunks_vec
           WHERE document_id = ANY($3::uuid[])
           ORDER BY embedding <=> $1::vector
           LIMIT $2`
        : `SELECT id, document_id, chunk_index, content,
                  1 - (embedding <=> $1::vector) AS similarity
           FROM document_chunks_vec
           ORDER BY embedding <=> $1::vector
           LIMIT $2`
      const params = hasDocFilter
        ? [`[${embedding.join(',')}]`, topK, filterDocIds]
        : [`[${embedding.join(',')}]`, topK]
      const res = await client.query(query, params)

      const minSim = this.config.get<number>('RAG_MIN_VECTOR_SIM', 0.45)
      const results: RetrievalResult[] = res.rows
        .filter((r: { similarity: number }) => r.similarity >= minSim)
        .map((r: { id: string; document_id: string; chunk_index: number; content: string; similarity: number }, i: number) => ({
          id: r.id,
          chunkId: r.id,
          documentId: r.document_id,
          content: r.content,
          score: r.similarity,
          rank: i,
        }))

      this.logger.log(
        `vector channel: topK=${topK} raw=${res.rows.length} ` +
          `passed(minSim=${minSim})=${results.length}` +
          (hasDocFilter ? ` docScope=${filterDocIds!.length}` : '') +
          (results.length > 0
            ? ` top1=${results[0]?.score.toFixed(3)} top${results.length}=${results[results.length - 1]?.score.toFixed(3)}`
            : ''),
      )
      return results
    } finally {
      await client.end()
    }
  }
}
