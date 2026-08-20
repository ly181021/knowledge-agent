/**
 * DocumentService 单测 —— 删除机制
 * 覆盖 4 个用例：
 * - softDelete：status→SOFT_DELETED 与 chunk 正文清理同事务
 * - list 不传 status：默认排除 SOFT_DELETED
 * - list 传 status=SOFT_DELETED：按传入状态过滤（审计入口）
 * - reindex 对已删除文档：抛业务异常且不进锁与流水线
 * 风格：手写 mock + 直接 new（项目惯例，见 stale-doc-scanner.service.spec.ts）
 */
import { DocumentStatus } from '@prisma/client'

// vector-gateway 间接 import uuid@14（纯 ESM），jest(CommonJS) 解析失败；测试用 mock 对象注入，mock 掉真模块
jest.mock('./vector-gateway/vector-gateway.service', () => ({
  VectorGatewayService: jest.fn(),
}))

import { DocumentService } from './document.service'
import type { QueryDocumentDto } from './dto/query-document.dto'

/** 构造 mock 依赖（INDEXED 文档为默认夹具） */
function makeMocks() {
  const doc = { id: 'd1', title: 'T', status: DocumentStatus.INDEXED, fileUrl: 'obj/key' }
  return {
    doc,
    prisma: {
      document: {
        findUnique: jest.fn().mockResolvedValue(doc),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ ...doc, status: DocumentStatus.SOFT_DELETED }),
      },
      documentChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
        count: jest.fn().mockResolvedValue(0),
      },
      // PrismaPromise 是 thenable，数组事务直接 Promise.all 即可
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
    minio: { remove: jest.fn().mockResolvedValue(undefined) },
    documentProducer: { sendIndex: jest.fn().mockResolvedValue(undefined) },
    vectorGateway: { remove: jest.fn().mockResolvedValue(undefined) },
    lockService: {
      acquire: jest.fn().mockResolvedValue('owner-1'),
      release: jest.fn().mockResolvedValue(undefined),
    },
  }
}

function makeService(m: ReturnType<typeof makeMocks>) {
  return new DocumentService(
    m.prisma as never,
    m.minio as never,
    m.documentProducer as never,
    m.vectorGateway as never,
    m.lockService as never,
  )
}

describe('DocumentService 删除机制', () => {
  let m: ReturnType<typeof makeMocks>
  let service: DocumentService

  beforeEach(() => {
    m = makeMocks()
    service = makeService(m)
  })

  it('softDelete：status 置 SOFT_DELETED，chunk 正文清理与之同事务，MinIO 与向量尽力清理', async () => {
    const res = await service.softDelete('d1')

    expect(res.status).toBe(DocumentStatus.SOFT_DELETED)
    expect(m.minio.remove).toHaveBeenCalledWith('obj/key')
    expect(m.vectorGateway.remove).toHaveBeenCalledWith('d1')
    // 两个 DB 操作作为同一 $transaction 的参数
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = m.prisma.$transaction.mock.calls[0][0] as unknown[]
    expect(ops).toHaveLength(2)
    expect(m.prisma.documentChunk.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'd1' } })
    expect(m.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: DocumentStatus.SOFT_DELETED },
    })
  })

  it('list 不传 status：where 默认排除 SOFT_DELETED', async () => {
    await service.list({ page: 1, size: 20 } as QueryDocumentDto)

    const where = m.prisma.document.findMany.mock.calls[0][0].where
    expect(where.status).toEqual({ not: DocumentStatus.SOFT_DELETED })
  })

  it('list 传 status=SOFT_DELETED：按传入状态过滤（审计入口可用）', async () => {
    await service.list({ page: 1, size: 20, status: DocumentStatus.SOFT_DELETED } as QueryDocumentDto)

    const where = m.prisma.document.findMany.mock.calls[0][0].where
    expect(where.status).toBe(DocumentStatus.SOFT_DELETED)
  })

  it('reindex 对已删除文档：抛 BusinessException(1005)，不加锁、不发流水线消息', async () => {
    m.prisma.document.findUnique.mockResolvedValue({ ...m.doc, status: DocumentStatus.SOFT_DELETED })

    await expect(service.reindex('d1')).rejects.toMatchObject({ bizCode: 1005 })
    expect(m.lockService.acquire).not.toHaveBeenCalled()
    expect(m.documentProducer.sendIndex).not.toHaveBeenCalled()
  })
})
