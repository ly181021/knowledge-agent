/**
 * ObservabilityService —— manage/observability/
 * 会话列表 + 会话详情 + 检索结果回溯
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { ExecutionMode } from '@/common/enums/execution-mode'

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name)

  constructor(private prisma: PrismaService) {}

  /** 会话列表（含筛选：keyword 标题模糊 / mode 执行模式 / dateFrom dateTo 时间范围） */
  async listSessions(params: {
    page?: number
    size?: number
    keyword?: string
    mode?: string
    dateFrom?: string
    dateTo?: string
  }) {
    const { page = 1, size = 20, keyword, mode, dateFrom, dateTo } = params
    const where = {
      AND: [
        keyword ? { title: { contains: keyword } } : {},
        mode ? { exchanges: { some: { executionMode: mode as ExecutionMode } } } : {},
        dateFrom ? { updatedAt: { gte: new Date(dateFrom) } } : {},
        dateTo ? { updatedAt: { lte: new Date(dateTo) } } : {},
      ],
    }

    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { exchanges: true } },
          exchanges: { select: { executionMode: true, durationMs: true }, take: 1, orderBy: { id: 'desc' } },
        },
      }),
      this.prisma.session.count({ where }),
    ])
    return {
      page,
      size,
      total,
      items: items.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        exchangeCount: s._count.exchanges,
        lastMode: s.exchanges[0]?.executionMode ?? null,
        lastDurationMs: s.exchanges[0]?.durationMs ?? null,
      })),
    }
  }

  /** 命中指定文档的会话列表（钻取用） */
  async documentSessions(docId: string) {
    const results = await this.prisma.retrievalResult.findMany({
      where: { docId, accepted: true },
      select: {
        exchange: {
          select: {
            sessionId: true,
            session: { select: { id: true, title: true, updatedAt: true } },
          },
        },
      },
    })
    // 应用层按 session 去重 + 聚合命中次数
    const sessionMap = new Map<string, { id: string; title: string; updatedAt: string; hitCount: number }>()
    for (const r of results) {
      const s = r.exchange.session
      const cur = sessionMap.get(s.id) ?? { id: s.id, title: s.title ?? '未命名会话', updatedAt: s.updatedAt.toISOString(), hitCount: 0 }
      cur.hitCount++
      sessionMap.set(s.id, cur)
    }
    return [...sessionMap.values()].sort((a, b) => b.hitCount - a.hitCount)
  }

  /** 会话详情 */
  async sessionDetail(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        exchanges: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            question: true,
            executionMode: true,
            durationMs: true,
          },
        },
      },
    })
    if (!session) throw new NotFoundException('会话不存在')
    return session
  }

  /** 检索结果回溯（按 session 级联查 retrievalResult） */
  async sessionRetrieval(sessionId: string) {
    const exchanges = await this.prisma.chatExchange.findMany({
      where: { sessionId },
      select: {
        id: true,
        question: true,
        retrievalResults: {
          orderBy: { rank: 'asc' },
        },
        channelExecutions: true,
      },
      orderBy: { id: 'asc' },
    })
    this.logger.log(`sessionRetrieval: ${sessionId} exchanges=${exchanges.length}`)
    return exchanges
  }
}
