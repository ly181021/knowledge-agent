/**
 * MetricsService —— ECharts 数据源
 * 4 个方法：tokenTrend / topHitDocuments / modeDistribution / sessionTrace
 */
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name)

  constructor(private prisma: PrismaService) {}

  /** 近 N 天 Token/QPS 折线 */
  async tokenTrend(days = 7): Promise<{ date: string; tokens: number; qps: number }[]> {
    // ChatExchange / ChatModelUsageTrace 表无 createdAt 列，用 Prisma client 查
    const since = new Date()
    since.setDate(since.getDate() - days)

    const traces = await this.prisma.chatModelUsageTrace.findMany({
      where: { exchange: { session: { createdAt: { gte: since } } } },
      select: {
        promptTokens: true,
        completionTokens: true,
        exchange: { select: { session: { select: { createdAt: true } } } },
      },
    })

    // 按天聚合
    const dayMap = new Map<string, { tokens: number; qps: number }>()
    for (const t of traces) {
      const date = t.exchange.session.createdAt.toISOString().slice(0, 10)
      const cur = dayMap.get(date) ?? { tokens: 0, qps: 0 }
      cur.tokens += t.promptTokens + t.completionTokens
      cur.qps += 1
      dayMap.set(date, cur)
    }

    return [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }))
  }

  /** 文档检索命中 Top10 柱状（RetrievalResult groupBy docId + join Document 取标题） */
  async topHitDocuments(): Promise<{ docId: string; docTitle: string; count: number }[]> {
    const rows = await this.prisma.retrievalResult.groupBy({
      by: ['docId'],
      _count: { docId: true },
      orderBy: { _count: { docId: 'desc' } },
      take: 10,
      where: { accepted: true },
    })
    // 批量查文档标题（避免 N+1）
    const docIds = rows.map((r) => r.docId).filter((id): id is string => id !== null)
    const docs = docIds.length > 0
      ? await this.prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, title: true } })
      : []
    const titleMap = new Map(docs.map((d) => [d.id, d.title]))
    return rows.map((r) => ({
      docId: r.docId ?? 'unknown',
      docTitle: titleMap.get(r.docId ?? '') ?? '已删除文档',
      count: r._count.docId,
    }))
  }

  /** 检索 vs 工具调用占比饼图（ChatExchange groupBy executionMode） */
  async modeDistribution(): Promise<{ mode: string; count: number }[]> {
    const rows = await this.prisma.chatExchange.groupBy({
      by: ['executionMode'],
      _count: true,
    })
    return rows.map((r) => ({ mode: r.executionMode, count: r._count }))
  }

  /** 单会话 trace 时间线（级联查 ChatExchange → traceStages/retrievalResults/...） */
  async sessionTrace(sessionId: string): Promise<unknown[]> {
    const exchanges = await this.prisma.chatExchange.findMany({
      where: { sessionId },
      include: {
        traceStages: { orderBy: { startedAt: 'asc' } },
        retrievalResults: true,
        channelExecutions: true,
        modelUsageTraces: true,
        toolTraces: true,
      },
      orderBy: { id: 'asc' },
    })
    this.logger.log(`sessionTrace: ${sessionId} exchanges=${exchanges.length}`)
    return exchanges
  }
}
