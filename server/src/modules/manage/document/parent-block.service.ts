/**
 * ParentBlockService —— Parent-Child 块聚合写入端
 * 检索用 Child 小块保精度，回答用 Parent 大块保完整性（2200 字符）
 * build：按章节边界（headingPath）聚合 child → parent；回填 DocumentChunk.parentBlockId + document_chunks_vec.parent_id
 * 无 headingPath（递归兜底产物）→ 按固定窗口 4 个 child 聚一个 parent
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/prisma/prisma.service'
import type { ChunkResult } from './strategy/chunk.service'

/** Parent 块最大字符 */
export const PARENT_MAX_CHARS = 2200
/** 无 headingPath 时的固定聚合窗口（child 个数） */
const FALLBACK_WINDOW = 4

interface ParentSlice {
  content: string
  childIds: number[] // chunkIndex 数组（与 (documentId, chunkIndex) 关联）
  childChunks: ChunkResult[]
}

@Injectable()
export class ParentBlockService {
  private readonly logger = new Logger(ParentBlockService.name)
  private readonly pgUrl: string

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.pgUrl = this.config.get<string>('PG_URL', 'postgresql://knowledgeagent:knowledgeagent123@localhost:5432/knowledgeagent')
  }

  /** 按章节边界聚合 child → parent；产出 parent 记录 + 回填 DocumentChunk.parentBlockId（reindex 时先删旧 parent） */
  async build(documentId: string, chunks: ChunkResult[]): Promise<void> {
    if (chunks.length === 0) return

    // 1. 按 headingPath 分组（无 headingPath 的递归块：FALLBACK_WINDOW 个 child 一组）
    const groups = this.groupByHeadingPath(chunks)
    let parentIndex = 0
    const chunkParentMap = new Map<number, string>() // chunkIndex -> parentId

    for (const group of groups) {
      for (const slice of this.sliceIntoParents(group)) {
        const record = await this.prisma.documentParentBlock.create({
          data: {
            documentId,
            content: slice.content,
            maxChars: PARENT_MAX_CHARS,
            parentIndex: parentIndex++,
            childChunkIds: slice.childIds,
          },
        })
        for (const c of slice.childChunks) chunkParentMap.set(c.index, record.id)
      }
    }

    // 2. 回填 child：Prisma DocumentChunk.parentBlockId（按 chunkIndex 定位）
    const entries = [...chunkParentMap.entries()]
    for (let i = 0; i < entries.length; i += 100) {
      await this.prisma.$transaction(
        entries.slice(i, i + 100).map(([chunkIndex, parentId]) =>
          this.prisma.documentChunk.updateMany({
            where: { documentId, chunkIndex },
            data: { parentBlockId: parentId },
          }),
        ),
      )
    }

    this.logger.log(`parent blocks built: doc=${documentId} parents=${parentIndex} chunks=${chunks.length}`)
  }

  /**
   * 回填 pg document_chunks_vec.parent_id（检索反查用）
   * 必须在 vectorGateway.write 之后调用：build 阶段 pg 行还不存在（执行顺序）
   * 从 DocumentChunk 表查映射（不依赖内存 chunks）
   */
  async backfillPg(documentId: string): Promise<void> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId, parentBlockId: { not: null } },
      select: { chunkIndex: true, parentBlockId: true },
    })
    const map = new Map<number, string>()
    for (const c of chunks) map.set(c.chunkIndex, c.parentBlockId!)
    await this.backfillPgParentIds(documentId, map)
    this.logger.log(`parent_id backfilled: doc=${documentId} chunks=${map.size}`)
  }

  /** 按 headingPath 分组；无 headingPath 的连续块按 FALLBACK_WINDOW 切组 */
  private groupByHeadingPath(chunks: ChunkResult[]): ChunkResult[][] {
    const groups: ChunkResult[][] = []
    let current: ChunkResult[] = []
    let currentPath: string | undefined

    const flush = () => {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
    }

    for (const c of chunks) {
      const path = c.headingPath ? c.headingPath.join('>') : undefined
      if (path === undefined) {
        // 递归兜底块：每 FALLBACK_WINDOW 个切一组
        if (currentPath !== undefined) flush() // 与上一组路径不同则先断开
        currentPath = undefined
        current.push(c)
        if (current.length >= FALLBACK_WINDOW) flush()
      } else if (path !== currentPath) {
        flush()
        currentPath = path
        current.push(c)
      } else {
        current.push(c)
      }
    }
    flush()
    return groups
  }

  /** 章节段 → parent 切片：文本 ≤ PARENT_MAX_CHARS 单个 parent；超长按 child 边界切多个（尽量保持 child 完整） */
  private sliceIntoParents(group: ChunkResult[]): ParentSlice[] {
    const parents: ParentSlice[] = []
    let cur: ChunkResult[] = []
    let len = 0

    const flush = () => {
      if (cur.length > 0) {
        parents.push({
          content: cur.map((x) => x.content).join('\n\n'),
          childIds: cur.map((x) => x.index),
          childChunks: cur,
        })
        cur = []
        len = 0
      }
    }

    for (const c of group) {
      if (cur.length > 0 && len + c.content.length > PARENT_MAX_CHARS) flush()
      cur.push(c)
      len += c.content.length
    }
    flush()
    return parents
  }

  /** 回填 pg parent_id（批量 VALUES update，chunk 量级几百条可接受） */
  private async backfillPgParentIds(documentId: string, map: Map<number, string>): Promise<void> {
    if (map.size === 0) return
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.pgUrl })
    await client.connect()
    try {
      const entries = [...map.entries()]
      for (let i = 0; i < entries.length; i += 200) {
        const batch = entries.slice(i, i + 200)
        // VALUES 参数必须显式类型标注（pg 无标注时默认 text，与 uuid/int 列比较报错）
        const values = batch.map(([, _parentId], j) => `($${j * 2 + 1}::uuid, $${j * 2 + 2}::int)`).join(',')
        const params: unknown[] = []
        for (const [chunkIndex, parentId] of batch) params.push(parentId, chunkIndex)
        await client.query(
          `UPDATE document_chunks_vec SET parent_id = v.parent_id
           FROM (VALUES ${values}) AS v(parent_id, chunk_index)
           WHERE document_id = $${params.length + 1}::uuid AND document_chunks_vec.chunk_index = v.chunk_index`,
          [...params, documentId],
        )
      }
    } finally {
      await client.end()
    }
  }
}
