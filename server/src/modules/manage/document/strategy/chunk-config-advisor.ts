/**
 * ChunkConfigAdvisor —— 按文档索引配置
 * 配置优先级：消息携带（reindex 手动覆盖）> DB 已存 DocumentIndexConfig > ChunkConfigAdvisor 推荐
 * pipeline 是有序策略数组：第一个为生产型（text→chunks），后续为转换型（chunks→chunks）
 * 执行顺序 = 数组顺序：先选的策略先执行
 */
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { Document } from '@prisma/client'

/** 切块策略枚举 */
export type ChunkStrategy = 'STRUCTURE' | 'RECURSIVE' | 'SEMANTIC' | 'LLM'

export interface IndexConfig {
  chunkSize: number
  overlap: number
  /** 有序策略流水线：按数组顺序执行（组合式切块引擎） */
  pipeline: ChunkStrategy[]
  /** 语义分块断点阈值（相邻句 cosine 相似度 < 此值 → 断块） */
  semanticThreshold: number
}

const DEFAULTS: IndexConfig = {
  chunkSize: 800,
  overlap: 120,
  // 默认主干 + 兜底：结构切块（生产）→ 递归（超长段兜底转换）
  pipeline: ['STRUCTURE', 'RECURSIVE'],
  semanticThreshold: 0.6,
}

@Injectable()
export class ChunkConfigAdvisor {
  constructor(private prisma: PrismaService) {}

  /** 推荐启发式：按文件类型/长度/质量分档 */
  recommend(fileType: string, charCount: number, quality?: string | null): IndexConfig {
    // quality=LOW：结构信号可能已被 OCR 噪声破坏，回退纯递归
    if (quality === 'LOW') return { ...DEFAULTS, pipeline: ['RECURSIVE'] }
    if (charCount > 50000) return { ...DEFAULTS, chunkSize: 1200, overlap: 200 }
    if (charCount < 2000) return { ...DEFAULTS, chunkSize: 400, overlap: 60, pipeline: ['RECURSIVE'] }
    if (fileType === 'txt' || fileType === 'md') return { ...DEFAULTS, pipeline: ['RECURSIVE'] }
    return { ...DEFAULTS }
  }

  /** 配置生效链路：消息携带 > DB 已存 > 推荐 */
  async loadOrRecommend(doc: Document, config?: Partial<IndexConfig>): Promise<IndexConfig> {
    if (config) return { ...DEFAULTS, ...config }
    const saved = await this.prisma.documentIndexConfig.findUnique({ where: { documentId: doc.id } })
    if (saved) {
      return {
        chunkSize: saved.chunkSize,
        overlap: saved.overlap,
        pipeline: this.parsePipeline(saved.pipeline),
        semanticThreshold: saved.semanticThreshold ?? DEFAULTS.semanticThreshold,
      }
    }
    return this.recommend(doc.fileType, doc.charCount ?? 0, doc.quality)
  }

  /**
   * 推荐配置 + 推荐理由（供前端只读展示）
   */
  getRecommendedWithReason(doc: Pick<Document, 'fileType' | 'charCount' | 'quality'>): IndexConfig & { reason: string } {
    const config = this.recommend(doc.fileType, doc.charCount ?? 0, doc.quality)
    const reason = this.explainRecommend(doc.fileType, doc.charCount ?? 0, doc.quality, config)
    return { ...config, reason }
  }

  /** 推荐理由文本（与 recommend 分支对应） */
  private explainRecommend(fileType: string, charCount: number, quality: string | null, cfg: IndexConfig): string {
    if (quality === 'LOW') return '文档质量较低（疑似扫描件/OCR 噪声），结构信号可能被破坏，纯递归切块'
    if (charCount > 50000) return `长文档（${charCount} 字 > 50000），用大块（${cfg.chunkSize}）保完整`
    if (charCount < 2000) return `短文档（${charCount} 字 < 2000），用小块（${cfg.chunkSize}）提精度、纯递归`
    if (fileType === 'txt' || fileType === 'md') return `${fileType} 无结构信号，纯递归`
    return `常规文档，默认流水线：${cfg.pipeline.join(' → ')}`
  }

  /**
   * 读 DB 已存配置（供前端判断系统推荐还是手动覆盖，右侧表单回填）
   */
  async getSavedConfig(documentId: string) {
    return this.prisma.documentIndexConfig.findUnique({ where: { documentId } })
  }

  /**
   * 保存手动覆盖配置（前端流水线组装后提交），source 置 MANUAL
   */
  async saveConfig(documentId: string, cfg: Partial<IndexConfig>): Promise<void> {
    const data = {
      chunkSize: cfg.chunkSize ?? DEFAULTS.chunkSize,
      overlap: cfg.overlap ?? DEFAULTS.overlap,
      pipeline: cfg.pipeline ?? DEFAULTS.pipeline,
      semanticThreshold: cfg.semanticThreshold ?? DEFAULTS.semanticThreshold,
      source: 'MANUAL',
    }
    await this.prisma.documentIndexConfig.upsert({
      where: { documentId },
      update: data,
      create: { documentId, ...data },
    })
  }

  /**
   * ：首次上传时把推荐配置持久化为快照（source='RECOMMEND'）。
   * 已有配置（MANUAL/RECOMMEND）不覆盖。让前端能展示推荐方案，用户可一键采纳或调整（调整即 saveConfig 覆盖 source=MANUAL）。
   */
  async persistRecommendIfAbsent(doc: Document, cfg: IndexConfig): Promise<void> {
    const existing = await this.prisma.documentIndexConfig.findUnique({ where: { documentId: doc.id } })
    if (existing) return // 已有配置（手动覆盖或已存推荐）不覆盖
    await this.prisma.documentIndexConfig.create({
      data: {
        documentId: doc.id,
        chunkSize: cfg.chunkSize,
        overlap: cfg.overlap,
        pipeline: cfg.pipeline,
        semanticThreshold: cfg.semanticThreshold,
        source: 'RECOMMEND',
      },
    }).catch(() => {
      // 并发场景（重投时两条消息同时 persist）可能 unique 冲突，静默忽略
    })
  }

  /** DB 的 pipeline 字段（Json）安全解析为 ChunkStrategy[] */
  private parsePipeline(raw: unknown): ChunkStrategy[] {
    if (!Array.isArray(raw)) return DEFAULTS.pipeline
    const valid: ChunkStrategy[] = ['STRUCTURE', 'RECURSIVE', 'SEMANTIC', 'LLM']
    return raw.filter((s): s is ChunkStrategy => typeof s === 'string' && valid.includes(s as ChunkStrategy))
  }
}
