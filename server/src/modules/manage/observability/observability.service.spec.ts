import { ObservabilityService } from './observability.service'
import type { PrismaService } from '@/prisma/prisma.service'

describe('ObservabilityService.listSessions 筛选', () => {
  it('传 keyword 时 where 含 title contains', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { session: { findMany, count }, retrievalResult: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService
    const svc = new ObservabilityService(prisma)
    await svc.listSessions({ page: 1, size: 20, keyword: '价格' })
    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ AND: expect.arrayContaining([expect.objectContaining({ title: { contains: '价格' } })]) })
  })

  it('传 mode 时 where 含 exchanges some', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { session: { findMany, count }, retrievalResult: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService
    const svc = new ObservabilityService(prisma)
    await svc.listSessions({ page: 1, size: 20, mode: 'RETRIEVAL' })
    const where = findMany.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain('executionMode')
  })

  it('不传任何筛选时 where 为空条件（返回全部）', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { session: { findMany, count }, retrievalResult: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService
    const svc = new ObservabilityService(prisma)
    await svc.listSessions({ page: 1, size: 20 })
    const where = findMany.mock.calls[0][0].where
    expect(where.AND.every((c: object) => Object.keys(c).length === 0)).toBe(true)
  })

  it('total 随筛选 count 变化', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(5)
    const prisma = { session: { findMany, count }, retrievalResult: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService
    const svc = new ObservabilityService(prisma)
    const res = await svc.listSessions({ keyword: 'x' })
    expect(res.total).toBe(5)
    expect(count).toHaveBeenCalled()
  })

  it('documentSessions 按会话去重 + 聚合命中次数', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { exchange: { sessionId: 's1', session: { id: 's1', title: '会话A', updatedAt: new Date('2026-07-29') } } },
      { exchange: { sessionId: 's1', session: { id: 's1', title: '会话A', updatedAt: new Date('2026-07-29') } } },
      { exchange: { sessionId: 's2', session: { id: 's2', title: '会话B', updatedAt: new Date('2026-07-28') } } },
    ])
    const prisma = { retrievalResult: { findMany } } as unknown as PrismaService
    const svc = new ObservabilityService(prisma)
    const res = await svc.documentSessions('d1')
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({ id: 's1', title: '会话A', hitCount: 2 })
    expect(res[1]).toMatchObject({ id: 's2', hitCount: 1 })
  })
})
