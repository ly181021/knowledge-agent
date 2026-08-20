-- pgvector 表初始化 SQL（Prisma 不支持 vector 类型，需 raw SQL 执行）
-- 幂等：全部使用 IF NOT EXISTS，可重复执行。

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks_vec (
  id UUID PRIMARY KEY,
  document_id VARCHAR NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  tsv_zh TSVECTOR,                                  -- 应用层 jieba 分词后写入（KeywordIndexService）
  parent_id UUID,                                   -- Parent-Child 回填（ParentBlockService.backfillPg）
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS document_chunks_vec_hnsw_idx --向量近似最近邻索引，找库里最近的相似块
  ON document_chunks_vec USING hnsw (embedding vector_cosine_ops);  -- 按照余弦相似度计算

CREATE INDEX IF NOT EXISTS document_chunks_vec_tsv_idx -- 查英文词
  ON document_chunks_vec USING gin (tsv);

-- 中文分词检索索引（tsv_zh + GIN）
CREATE INDEX IF NOT EXISTS document_chunks_vec_tsv_zh_idx
  ON document_chunks_vec USING gin (tsv_zh);

-- 向量写入幂等 upsert 的唯一键（reindex 先写后删前置）
ALTER TABLE document_chunks_vec ADD CONSTRAINT uq_doc_chunk UNIQUE (document_id, chunk_index);
