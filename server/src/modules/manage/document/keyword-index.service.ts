/**
 * KeywordIndexService —— 中文分词关键词索引写入端
 * 写入 document_chunks_vec.tsv_zh（应用层 jieba 分词后 to_tsvector('simple', tokens)），
 * 查询端 KeywordChannel 主查 tsv_zh、命中不足时回退 tsv（英文/编号场景）
 * tsv_zh 为普通列（应用写入），保留原 generated 列 tsv 做兜底
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { tokenize } from '@/common/utils/tokenizer'
import type { ChunkResult } from './strategy/chunk.service'

@Injectable()
export class KeywordIndexService {
  private readonly logger = new Logger(KeywordIndexService.name)
  private readonly pgUrl: string

  constructor(private config: ConfigService) {
    this.pgUrl = this.config.getOrThrow<string>('PG_URL')
  }

  /** 批量写入 tsv_zh（每批 200 行 VALUES 更新）；reindex 场景复用同一方法（先写后删事务边界内） */
  async index(documentId: string, chunks: ChunkResult[]): Promise<void> {
    if (chunks.length === 0) return
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const rows = chunks.map((c) => ({ tokens: tokenize(c.content), chunkIndex: c.index }))
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200)
        // VALUES 参数必须显式类型标注（pg 无标注时默认 text，与 int 列比较报错）
        const values = batch.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}::int)`).join(',')
        const params: unknown[] = []
        for (const r of batch) params.push(r.tokens, r.chunkIndex)
        await client.query(
          `UPDATE document_chunks_vec SET tsv_zh = to_tsvector('simple', v.tokens)
           FROM (VALUES ${values}) AS v(tokens, chunk_index)
           WHERE document_id = $${params.length + 1}::uuid AND document_chunks_vec.chunk_index = v.chunk_index`,
          [...params, documentId],
        )
      }
      this.logger.log(`keyword index done: doc=${documentId} chunks=${chunks.length}`)
    } finally {
      await client.end()
    }
  }

  /** reindex 重建（与 index 同实现，位于先写后删事务边界内） */
  async reindex(documentId: string, chunks: ChunkResult[]): Promise<void> {
    return this.index(documentId, chunks)
  }
}
