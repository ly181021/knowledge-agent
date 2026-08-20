/**
 * RetrievalChannel —— 双通道检索接口
 * RAG 引擎
 */

/** 单条检索结果 */
export interface RetrievalResult {
  id: string
  chunkId: string
  documentId: string
  content: string
  score: number
  rank: number
}

/** 检索通道接口 */
export interface RetrievalChannel {
  /**
   * @param question 检索问题
   * @param topK 返回条数上限
   * @param filterDocIds 限定文档 id 集合（当前文档问答模式用），为空/undefined 时不限制（全库）
   */
  retrieve(question: string, topK?: number, filterDocIds?: string[]): Promise<RetrievalResult[]>
}
