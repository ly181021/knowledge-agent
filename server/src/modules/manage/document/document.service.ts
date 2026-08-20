/**
 * DocumentService —— 文档管理：上传落 MinIO + DB（status=PARSING）→ Kafka 异步触发 document-parse（流水线在 consumer 执行）
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Document, DocumentStatus, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '@/prisma/prisma.service'
import { MinioService } from '@/modules/infra/minio.provider'
import { BusinessException } from '@/common/filters/business.exception'
import { paginate, PageRes } from '@/common/utils/paging'
import { DocumentProducer } from './mq/document-producer'
import { PARSE_STAGE, ERROR_CODE, truncateMsg } from './document-parse-stage'
import type { IndexConfig } from './strategy/chunk-config-advisor'
import { VectorGatewayService } from './vector-gateway/vector-gateway.service'
import { ReindexLockService } from './reindex-lock.service'
import { QueryDocumentDto } from './dto/query-document.dto'
import { UploadDocumentDto } from './dto/upload-document.dto'

type DocumentWhereInput = Prisma.DocumentWhereInput

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name)

  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private documentProducer: DocumentProducer,
    private vectorGateway: VectorGatewayService,
    private lockService: ReindexLockService,
  ) {}

  /** 列表（分页/搜索/筛选，聚合 chunkCount + headingStrategy） */
  async list(q: QueryDocumentDto): Promise<PageRes<Document>> {
    const where: Prisma.DocumentWhereInput = {}
    if (q.keyword) {
      where.OR = [
        { title: { contains: q.keyword } },
        { fileName: { contains: q.keyword } },
      ]
    }
    // 已删除记录默认不出现；显式传 status=SOFT_DELETED 供审计筛选
    where.status = q.status ?? { not: DocumentStatus.SOFT_DELETED }

    const res = await paginate<DocumentWhereInput, undefined, Document>(
      this.prisma.document as unknown as Parameters<typeof paginate>[0],
      where,
      q.page,
      q.size,
      { orderBy: { createdAt: 'desc' } },
    )

    const docs = res.items as (Document & { chunkCount?: number; headingStrategy?: string | null })[]
    await Promise.all(
      docs.map(async (d) => {
        const count = await this.prisma.documentChunk.count({ where: { documentId: d.id } })
        d.chunkCount = count
        // 切块策略用 fileType 粗推断：list 不查 raw 表（性能考虑），md/docx 视为结构切块
        if (count > 0) {
          d.headingStrategy = d.fileType === 'md' || d.fileType === 'docx' ? '结构' : '递归'
        } else {
          d.headingStrategy = null
        }
      }),
    )
    return res
  }

  /** 详情 */
  async detail(id: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException('文档不存在')
    return doc
  }

  /** 概览聚合：Document 基础字段 + chunkCount + totalDurationMs（从 taskLogs 聚合） */
  async overview(id: string): Promise<Document & { chunkCount: number; totalDurationMs: number }> {
    const doc = await this.prisma.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException('文档不存在')

    const [chunkCount, logs] = await Promise.all([
      this.prisma.documentChunk.count({ where: { documentId: id } }),
      this.prisma.documentTaskLog.findMany({
        where: { documentId: id },
        select: { durationMs: true },
      }),
    ])

    const totalDurationMs = logs
      .filter((l) => l.durationMs != null)
      .reduce((sum, l) => sum + (l.durationMs as number), 0)

    return { ...doc, chunkCount, totalDurationMs }
  }

  /**
   * Chunk 预览：合并 Prisma DocumentChunk + pg metadata.headingPath
   * 跨库查询：MySQL 取 content/parentBlockId，PG 取 headingPath，按 chunk.id 合并
   */
  async listChunks(id: string) {
    // 1. Prisma 查 MySQL（content / chunkIndex / parentBlockId）
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, chunkIndex: true, content: true, parentBlockId: true },
    })

    if (chunks.length === 0) return []

    // 2. pg 查 PostgreSQL（metadata.headingPath）
    const metaMap = await this.vectorGateway.getChunksMeta(id)

    // 3. 按 id 合并，content 截断预览（前端展示用，全文太长）
    return chunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      content: c.content,
      preview: c.content.slice(0, 100) + (c.content.length > 100 ? '…' : ''),
      charCount: c.content.length,
      headingPath: metaMap.get(c.id) ?? [],
      parentBlockId: c.parentBlockId,
    }))
  }

  /** 上传：落 MinIO + 落 DB（状态 PARSING + 元信息）+ Kafka 异步触发流水线 */
  async upload(file: { originalname: string; buffer: Buffer; size: number; mimetype: string }, dto: UploadDocumentDto): Promise<Document> {
    const ext = (file.originalname.split('.').pop() ?? 'txt').toLowerCase()

    // 类型白名单：只允许 pdf/docx/txt/md（其他类型按 utf8 硬读会乱码进库）
    const ALLOWED_EXTS = ['pdf', 'docx', 'txt', 'md']
    if (!ALLOWED_EXTS.includes(ext)) {
      throw new BusinessException(1003, `不支持的文件类型：.${ext}（仅支持 ${ALLOWED_EXTS.join(' / ')}）`)
    }

    const objectKey = `documents/${randomUUID()}/${file.originalname}`

    // 1. 落 MinIO
    await this.minio.upload(objectKey, file.buffer, file.size)

    // 2. 落 DB，状态 PARSING + 元信息（知识域/业务分类/标签，供检索侧 scope 过滤与列表筛选）
    const doc = await this.prisma.document.create({
      data: {
        title: dto.title ?? file.originalname.replace(/\.[^.]+$/, ''),
        fileName: file.originalname,
        fileUrl: objectKey,
        fileType: ext,
        fileSize: file.size,
        status: DocumentStatus.PARSING,
        parseStage: PARSE_STAGE.UPLOADED,
        scopeId: dto.scopeId ?? null,
        topicId: dto.topicId ?? null,
        businessType: dto.businessType ?? null,
        tags: dto.tags ? this.parseTags(dto.tags) : undefined,
      },
    })

    // 3. Kafka 异步触发流水线（document-parse topic，consumer 见 mq/document-parse.consumer.ts）
    //     发送失败即时标 FAILED + 清 MinIO 孤儿文件，不卡在 PARSING 等补偿扫描；失败记录保留在列表供查看
    try {
      await this.documentProducer.sendParse(doc.id)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      this.logger.error(`[upload] Kafka 发送失败 doc=${doc.id}：${reason}，标记 FAILED 并清理 MinIO 孤儿文件`)
      // 回滚：DB 标 FAILED + 删 MinIO 文件（避免存储泄漏）
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.FAILED, errorCode: ERROR_CODE.KAFKA_SEND_FAILED, errorMsg: truncateMsg(reason) },
      }).catch(() => {}) // DB 回滚失败不掩盖原始的 Kafka 错误
      try { await this.minio.remove(objectKey) } catch { /* MinIO 删除失败不阻塞 */ }
      throw new BusinessException(1004, `文档已接收但处理队列发送失败，请重试上传（${reason}）`)
    }

    return doc
  }

  /** multipart 的 tags 是 JSON 字符串，容错解析为数组 */
  private parseTags(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : [raw]
    } catch {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  /**
   * 重新索引：status→INDEXING + Kafka 触发 document-index
   * 防重入：双层锁（ReindexLockService：进程内 Map 短路 + Redis SET NX EX 10min）+ status=INDEXING 双检查；
   *         成功路径锁由 consumer 释放
   * @param config 可选手动覆盖配置，透传到 Kafka 消息，consumer 优先用消息携带值
   */
  async reindex(id: string, config?: Partial<IndexConfig>): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException('文档不存在')
    if (doc.status === DocumentStatus.INDEXING) throw new BusinessException(1001, '文档正在重建中，请稍后再试')
    // 已删除文档原件已物理清除，重建必然失败，显式拒绝
    if (doc.status === DocumentStatus.SOFT_DELETED) throw new BusinessException(1005, '文档已删除，无法重建索引')

    // 双层锁：进程层短路 + Redis NX（owner 标识，失败回滚可比对释放，防误删他人锁）
    const owner = await this.lockService.acquire(id)

    try {
      const updated = await this.prisma.document.update({
        where: { id },
        // reindex 从头跑流水线：重置 parseStage + 清旧错误（consumer 会重新推进 parseStage）
        data: { status: DocumentStatus.INDEXING, parseStage: PARSE_STAGE.UPLOADED, errorCode: null, errorMsg: null },
      })
      await this.documentProducer.sendIndex(id, config)
      return updated
    } catch (e) {
      // 发消息失败 → 状态回滚，锁释放（owner 比对 + TTL 兜底）
      await this.lockService.release(id, owner)
      throw e
    }
  }

  /** 软删：status→SOFT_DELETED + MinIO removeObject + 清理向量 + 同事务清 chunk 正文 */
  async softDelete(id: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException('文档不存在')

    // MinIO 里的原始文件清掉
    try {
      await this.minio.remove(doc.fileUrl)
    } catch {
      // MinIO 删除失败不阻塞软删
    }

    // 清理向量表
    try {
      await this.vectorGateway.remove(id)
    } catch {
      // 清理失败不阻塞
    }

    // chunk 正文与删除标记同事务：正文残留等于管理面泄漏，两者必须同生共死
    const [, updated] = await this.prisma.$transaction([
      this.prisma.documentChunk.deleteMany({ where: { documentId: id } }),
      this.prisma.document.update({
        where: { id },
        data: { status: DocumentStatus.SOFT_DELETED },
      }),
    ])
    return updated
  }
}
