/**
 * KeywordChannel —— 关键词检索通道
 * 中文检索：主查 tsv_zh（应用层 jieba 分词后写入，KeywordIndexService），
 *   查询词同样分词 + 停用词过滤 → plainto_tsquery('simple', tokens)
 * 回退：tsv_zh 命中 < topK 时用原 tsv 列（simple，不分词）补足，覆盖英文/订单号/配置项名场景
 * tsv 列由 migration 的 GENERATED ALWAYS AS (to_tsvector('simple', content)) 自动填充
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { tokenize } from '@/common/utils/tokenizer'
import type { RetrievalChannel, RetrievalResult } from './retrieval-channel'

interface Row {
  id: string
  document_id: string
  chunk_index: number
  content: string
  rank_score: number
}

@Injectable()
export class KeywordChannel implements RetrievalChannel {
  private readonly logger = new Logger(KeywordChannel.name)
  private readonly pgUrl: string

  constructor(private config: ConfigService) {
    this.pgUrl = this.config.getOrThrow<string>('PG_URL')
  }

  async retrieve(question: string, topK = 8, filterDocIds?: string[]): Promise<RetrievalResult[]> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const hasDocFilter = filterDocIds && filterDocIds.length > 0
      // document_id 是 uuid 列，参数数组必须 cast uuid[]（否则报 operator does not exist: uuid = text）
      const docFilter = hasDocFilter ? 'AND document_id = ANY($3::uuid[])' : ''
      const tokens = tokenize(question)

      // 1. 主查 tsv_zh（中文分词；纯停用词输入 tokens 为空 → 跳过主查直接回退 tsv）
      let results: RetrievalResult[] = []
      if (tokens) {
        const zhQuery = `SELECT id, document_id, chunk_index, content,
                                ts_rank(tsv_zh, plainto_tsquery('simple', $1)) AS rank_score
                         FROM document_chunks_vec
                         WHERE tsv_zh @@ plainto_tsquery('simple', $1) ${docFilter}
                         ORDER BY rank_score DESC
                         LIMIT $2`
        const zhParams = hasDocFilter ? [tokens, topK, filterDocIds] : [tokens, topK]
        const res = await client.query(zhQuery, zhParams)
        results = this.toResults(res.rows)
      }

      // 2. 回退：命中 < topK 时用 tsv（simple 原列）补足，排除已命中 id
      if (results.length < topK) {
        const excluded = results.map((r) => r.id)
        const tsvQuery = `SELECT id, document_id, chunk_index, content,
                                 ts_rank(tsv, plainto_tsquery('simple', $1)) AS rank_score
                          FROM document_chunks_vec
                          WHERE tsv @@ plainto_tsquery('simple', $1)
                            AND id <> ALL($3::uuid[]) ${docFilter ? 'AND document_id = ANY($4::uuid[])' : ''}
                          ORDER BY rank_score DESC
                          LIMIT $2`
        const tsvParams = hasDocFilter
          ? [question, topK - results.length, excluded, filterDocIds]
          : [question, topK - results.length, excluded]
        const rest = await client.query(tsvQuery, tsvParams)
        results = results.concat(this.toResults(rest.rows))
      }

      const minRankScore = this.config.get<number>('RAG_MIN_KEYWORD_SCORE', 0.01)
      const passed = results.filter((r) => r.score >= minRankScore)
      this.logger.log(
        `keyword channel: topK=${topK} zh=${results.length > 0 ? 'on' : 'off'} raw=${results.length} ` +
          `passed(minScore=${minRankScore})=${passed.length}` +
          (hasDocFilter ? ` docScope=${filterDocIds!.length}` : '') +
          (passed.length > 0 ? ` top1=${passed[0]?.score.toFixed(4)}` : ''),
      )
      return passed
    } finally {
      await client.end()
    }
  }

  private toResults(rows: Row[]): RetrievalResult[] {
    return rows.map((r, i) => ({
      id: r.id,
      chunkId: r.id,
      documentId: r.document_id,
      content: r.content,
      score: r.rank_score,
      rank: i,
    }))
  }
}
