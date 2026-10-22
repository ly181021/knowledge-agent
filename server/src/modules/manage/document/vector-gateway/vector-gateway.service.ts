/**
 * VectorGatewayService —— 向量化 + 向量存储写入
 * embedMany 分批（batch=32，并发 3 路）+ 指数退避重试
 * 多值 INSERT upsert（(document_id, chunk_index) 唯一键，reindex 幂等覆盖）+ Prisma createMany
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { embedMany } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { PrismaService } from '@/prisma/prisma.service'
import { LlmService } from '@/modules/infra/llm.provider'
import type { ChunkResult } from '../strategy/chunk.service'

/** 每批 embedding 数量 */
const EMBED_BATCH = 32
/** 并发批数（避免打满 embedding 服务配额） */
const CONCURRENCY = 3
/** 每批 INSERT 行数 */
const INSERT_BATCH = 50
/** 重试：首次 + 2 次，指数退避 200ms → 1200ms（对齐 ToolRetryInterceptor） */
const RETRY_ATTEMPTS = 3
const RETRY_INITIAL_DELAY = 200
const RETRY_MAX_DELAY = 1200

@Injectable()
export class VectorGatewayService {
  private readonly logger = new Logger(VectorGatewayService.name)
  private readonly pgUrl: string

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private config: ConfigService,
  ) {
    this.pgUrl = this.config.getOrThrow<string>('PG_URL')
  }

  /**
   * 向量化并写入 document_chunks_vec + Prisma DocumentChunk
   */
  async write(documentId: string, chunks: ChunkResult[]): Promise<void> {
    if (chunks.length === 0) return

    // 1. embedMany 分批 + 并发 3 路 + 指数退避重试
    const embeddings = await this.embedInBatches(chunks.map((c) => c.content))
    this.logger.log(`embedded ${chunks.length} chunks for doc ${documentId}`)

    // 2. 多值 INSERT upsert 写 document_chunks_vec（batch=50）
    //    (document_id, chunk_index) 唯一键 → reindex 时旧数据被幂等覆盖（先写后删的前半）
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const chunkIds: string[] = []
      let rows: string[] = []
      let params: unknown[] = []
      const flush = async () => {
        if (rows.length === 0) return
        await client.query(
          `INSERT INTO document_chunks_vec (id, document_id, chunk_index, content, embedding, metadata)
           VALUES ${rows.join(',')}
           ON CONFLICT (document_id, chunk_index) DO UPDATE
             SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
          params,
        )
        rows = []
        params = []
      }
      for (let i = 0; i < chunks.length; i++) {
        const id = uuidv4()
        chunkIds.push(id)
        const base = params.length
        params.push(
          id,
          documentId,
          chunks[i].index,
          chunks[i].content,
          `[${embeddings[i].join(',')}]`,
          JSON.stringify(chunks[i].headingPath ? { headingPath: chunks[i].headingPath } : {}),
        )
        rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`)
        if (rows.length >= INSERT_BATCH) await flush()
      }
      await flush()
      this.logger.log(`wrote ${chunks.length} chunks to pg for doc ${documentId}`)

      // 3. Prisma createMany 批量写 DocumentChunk（batch=200，skipDuplicates）
      const chunkRows = chunks.map((c, i) => ({
        id: chunkIds[i],
        documentId,
        chunkIndex: c.index,
        content: c.content,
        embeddingId: chunkIds[i],
      }))
      for (let i = 0; i < chunkRows.length; i += 200) {
        await this.prisma.documentChunk.createMany({
          data: chunkRows.slice(i, i + 200),
          skipDuplicates: true,
        })
      }
      this.logger.log(`wrote ${chunks.length} chunks to prisma for doc ${documentId}`)
    } finally {
      await client.end()
    }
  }

  /** embedMany 分批 + 并发 CONCURRENCY 路，结果按下标对齐 */
  private async embedInBatches(values: string[]): Promise<number[][]> {
    const results: number[][] = new Array(values.length)
    const batches: { start: number; values: string[] }[] = []
    for (let i = 0; i < values.length; i += EMBED_BATCH) {
      batches.push({ start: i, values: values.slice(i, i + EMBED_BATCH) })
    }
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      for (;;) {
        const batch = batches[cursor++]
        if (!batch) return
        const vec = await this.embedWithRetry(batch.values)
        for (let k = 0; k < vec.length; k++) results[batch.start + k] = vec[k]
      }
    })
    await Promise.all(workers)
    return results
  }

  /** 单批 embedding + 指数退避重试（失败重试 2 次后抛出） */
  private async embedWithRetry(values: string[]): Promise<number[][]> {
    let delay = RETRY_INITIAL_DELAY
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        const { embeddings } = await embedMany({ model: this.llm.getEmbeddingModel(), values })
        return embeddings
      } catch (e) {
        if (attempt === RETRY_ATTEMPTS - 1) throw e
        this.logger.warn(`embedMany failed attempt=${attempt + 1}: ${e instanceof Error ? e.message : String(e)}`)
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, RETRY_MAX_DELAY)
      }
    }
    throw new Error('unreachable')
  }

  /**
   * 软删时清理向量（可选，调用方决定）
   */
  async remove(documentId: string): Promise<void> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      await client.query('DELETE FROM document_chunks_vec WHERE document_id = $1', [documentId])
    } finally {
      await client.end()
    }
  }

  /**
   * 读 chunks 的 metadata（含 headingPath），供 03 chunk 预览展示章节路径
   * @returns Map<chunk_id, headingPath[]> —— 无 headingPath 的块值为空数组
   */
  async getChunksMeta(documentId: string): Promise<Map<string, string[]>> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const res = await client.query(
        `SELECT id, metadata FROM document_chunks_vec WHERE document_id = $1 ORDER BY chunk_index`,
        [documentId],
      )
      const map = new Map<string, string[]>()
      for (const row of res.rows) {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {}
        map.set(row.id, Array.isArray(meta.headingPath) ? meta.headingPath : [])
      }
      return map
    } finally {
      await client.end()
    }
  }
}
