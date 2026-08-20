import { MetricsService } from './metrics.service'
import type { PrismaService } from '@/prisma/prisma.service'

describe('MetricsService.topHitDocuments', () => {
  it('返回 docTitle（join Document 表），未知 docId 用"已删除文档"', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { docId: 'd1', _count: { docId: 3 } },
      { docId: 'd2', _count: { docId: 1 } },
    ])
    const findMany = jest.fn().mockResolvedValue([
      { id: 'd1', title: '产品手册.pdf' },
    ])
    const prisma = {
      retrievalResult: { groupBy },
      document: { findMany },
      chatModelUsageTrace: { findMany: jest.fn().mockResolvedValue([]) },
      chatExchange: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService
    const svc = new MetricsService(prisma)
    const result = await svc.topHitDocuments()
    expect(result).toEqual([
      { docId: 'd1', docTitle: '产品手册.pdf', count: 3 },
      { docId: 'd2', docTitle: '已删除文档', count: 1 },
    ])
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ['d1', 'd2'] } }, select: { id: true, title: true } })
  })

  it('空结果时返回空数组', async () => {
    const prisma = {
      retrievalResult: { groupBy: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      chatModelUsageTrace: { findMany: jest.fn().mockResolvedValue([]) },
      chatExchange: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService
    const svc = new MetricsService(prisma)
    expect(await svc.topHitDocuments()).toEqual([])
  })
})
