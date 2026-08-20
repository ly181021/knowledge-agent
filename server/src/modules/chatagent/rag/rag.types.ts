/**
 * Citation —— 引用来源
 * citations 回传前端（帧 2）
 */
export interface Citation {
  chunkId: string
  documentId: string
  content: string
  score: number
  rank: number
}

/** 单通道执行统计（写入 ChannelExecution 表） */
export interface ChannelStat {
  channel: string        // vector / keyword
  recalled: number       // 召回数
  accepted: number       // 融合后入选数
  durationMs?: number
}

/** 单条 chunk 检索结果（写入 RetrievalResult 表） */
export interface ChunkScore {
  chunkId: string
  documentId: string
  vectorScore?: number
  keywordScore?: number
  rrfScore: number
  rerankScore?: number
  accepted: boolean
  rank: number
}

/**
 * RAG 检索结果（含 channels + results 供 trace 记录）
 */
export interface RagResult {
  evidence: string
  citations: Citation[]
  channels: ChannelStat[]
  results: ChunkScore[]
}
