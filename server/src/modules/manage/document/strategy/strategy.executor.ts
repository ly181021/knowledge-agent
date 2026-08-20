/**
 * StrategyExecutor —— 组合式切块流水线
 * pipeline 是有序策略数组，按顺序执行：
 *   - 第一个策略必须是生产型（STRUCTURE / RECURSIVE）：从 text 产出初始 chunks
 *   - 后续策略是转换型（SEMANTIC / LLM）：对 chunks 做精修/增强
 * STRUCTURE 结构切块（按标题/段落，产 headingPath）；RECURSIVE 递归兜底（按分隔符，无结构信号时用）；
 * SEMANTIC 语义精修（相邻句 embedding 相似度断块）；LLM 智能切块（歧义段用 LLM 决策边界）
 */
import { Injectable, Logger } from '@nestjs/common'
import { StructureChunkService } from './structure-chunk.service'
import { SemanticChunker } from './semantic-chunker'
import { LlmSplitter } from './llm-splitter'
import { ChunkService } from './chunk.service'
import type { ChunkResult, SplitResult } from './chunk.service'
import type { IndexConfig, ChunkStrategy } from './chunk-config-advisor'
import type { HeadingLine } from './heading-detector'

/** execute 返回 chunks + headings（透出 headings 供 consumer 构建结构节点） */
export interface ExecuteResult {
  chunks: ChunkResult[]
  headings?: HeadingLine[]
}

/** 生产型策略：从 text 产出 chunks */
const PRODUCERS: ChunkStrategy[] = ['STRUCTURE', 'RECURSIVE']
/** 转换型策略：chunks → chunks */
const TRANSFORMERS: ChunkStrategy[] = ['SEMANTIC', 'LLM']

@Injectable()
export class StrategyExecutor {
  private readonly logger = new Logger(StrategyExecutor.name)

  constructor(
    private structureChunker: StructureChunkService,
    private semanticChunker: SemanticChunker,
    private llmSplitter: LlmSplitter,
    private chunkService: ChunkService,
  ) {}

  /** 按 pipeline 顺序执行组合切块（cfg.pipeline 来自 ChunkConfigAdvisor）。 返回 { chunks, headings? } */
  async execute(text: string, cfg: IndexConfig, quality?: string | null): Promise<ExecuteResult> {
    const pipeline: ChunkStrategy[] = cfg.pipeline.length > 0 ? cfg.pipeline : ['STRUCTURE', 'RECURSIVE']
    this.logger.log(`pipeline execute: [${pipeline.join(' → ')}] chunkSize=${cfg.chunkSize}`)

    // 1. 找第一个生产型策略，切出初始 chunks
    const producerIdx = pipeline.findIndex((s) => PRODUCERS.includes(s))
    if (producerIdx === -1) {
      // 无生产型策略（如纯 ['SEMANTIC']），兜底用递归
      this.logger.warn(`pipeline 无生产型策略，兜底 RECURSIVE`)
      const { chunks } = await this.chunkService.split(text, { chunkSize: cfg.chunkSize, overlap: cfg.overlap })
      const transformed = await this.runTransformers(chunks, pipeline, cfg, quality)
      return { chunks: transformed }
    }

    const producer = pipeline[producerIdx]
    // ：split 返回 { chunks, headings? }；STRUCTURE 才有 headings，RECURSIVE 无
    const splitResult: SplitResult = producer === 'STRUCTURE'
      ? await this.structureChunker.split(text, { chunkSize: cfg.chunkSize, overlap: cfg.overlap })
      : await this.chunkService.split(text, { chunkSize: cfg.chunkSize, overlap: cfg.overlap })
    let chunks = splitResult.chunks
    this.logger.log(`生产型 ${producer} 产出 ${chunks.length} 块`)

    // 2. 执行后续转换型策略（生产型之后的，按顺序）
    const transformers = pipeline.slice(producerIdx + 1).filter((s) => TRANSFORMERS.includes(s))
    chunks = await this.runTransformers(chunks, transformers, cfg, quality)

    this.logger.log(`pipeline 完成，最终 ${chunks.length} 块`)
    return { chunks, headings: splitResult.headings }
  }

  /** 按顺序执行转换型策略（SEMANTIC / LLM） */
  private async runTransformers(
    chunks: ChunkResult[],
    transformers: ChunkStrategy[],
    cfg: IndexConfig,
    quality?: string | null,
  ): Promise<ChunkResult[]> {
    for (const strategy of transformers) {
      if (strategy === 'SEMANTIC') {
        chunks = await this.semanticChunker.refineChunks(chunks, cfg)
        this.logger.log(`SEMANTIC 精修后 ${chunks.length} 块`)
      } else if (strategy === 'LLM') {
        chunks = await this.llmSplitter.enhance(chunks, cfg, quality)
        this.logger.log(`LLM 增强后 ${chunks.length} 块`)
      }
    }
    return chunks
  }
}
