/**
 * DocumentParseConsumer 回归单测
 * 覆盖：
 * - INDEXED 幂等短路（不跑流水线、释放锁、不抛错）
 * - LOW 质量分支（status=FAILED、taskLog.write、不 rethrow、后续阶段不调）
 * - happy path（六阶段按序调用、status=INDEXED、tokenCount=ceil(len/4)）
 * - 阶段抛错 → FAILED + taskLog.write FAILED_STAGE + rethrow
 * - finally 必释放锁（happy + 失败 + 短路三条路径都调 lockService.forceRelease）
 * - 释放锁抛错（Redis 不可用）不影响主流程（service 吞 catch 语义）
 * 风格：手写 mock + 直接 new（kafka 给空对象，避免 onModuleInit 触发 consume）。
 * handle 是 private，用 (consumer as any).handle(raw) 绕过——项目内 as any/as never 已是惯例。
 */
import { DocumentStatus } from '@prisma/client'

// vector-gateway 间接 import uuid@14（纯 ESM），jest(CommonJS) 解析失败。
// 整个 vectorGateway 在测试里用 mock 对象注入，不需要真模块，mock 掉避开 ESM 问题。
jest.mock('../vector-gateway/vector-gateway.service', () => ({
  VectorGatewayService: jest.fn(),
}))

import { DocumentParseConsumer } from './document-parse.consumer'

const DOC_ID = 'doc-1'

/** 构造一个最小 doc 行（status 可覆盖） */
const makeDoc = (over: Partial<{ status: DocumentStatus }> = {}) => ({
  id: DOC_ID,
  status: DocumentStatus.PARSING,
  ...over,
})

/** 批量产出 12 个 mock 依赖（kafka 给空对象，测试全程不碰） */
function makeMocks() {
  return {
    prisma: {
      document: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      documentChunk: { deleteMany: jest.fn() },
      documentParentBlock: { deleteMany: jest.fn() },
      //  结构节点 + 画像
      documentStructureNode: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      documentProfile: {},
    },
    // 双层锁：consumer 只经 ReindexLockService 释放（forceRelease），不再直连 redis
    lockService: { forceRelease: jest.fn().mockResolvedValue(undefined) },
    //  重投限流：consumer 失败时重发带 retryCount+1 的消息
    documentProducer: { sendParse: jest.fn().mockResolvedValue(undefined), sendIndex: jest.fn().mockResolvedValue(undefined) },
    //  文档画像
    documentProfileService: { generate: jest.fn().mockResolvedValue(undefined) },
    parser: { parse: jest.fn() },
    vectorGateway: { write: jest.fn(), remove: jest.fn() },
    taskLog: {
      // stage 透传：(_, _, fn) => fn，避免模拟内部 write；同时记录 stage 名供断言顺序
      stage: jest.fn((_id: string, _stage: string, fn: () => Promise<unknown>) => fn()),
      write: jest.fn(),
    },
    qualityDetector: { detect: jest.fn() },
    parentBlockService: { build: jest.fn(), backfillPg: jest.fn() },
    keywordIndex: { index: jest.fn() },
    configAdvisor: { loadOrRecommend: jest.fn(), persistRecommendIfAbsent: jest.fn().mockResolvedValue(undefined) },
    strategyExecutor: { execute: jest.fn().mockResolvedValue({ chunks: [{ index: 0, content: 'text' }], headings: [] }) },
  }
}

/** 用 mock 工厂构造 consumer 实例 */
function makeConsumer(m: ReturnType<typeof makeMocks>) {
  return new DocumentParseConsumer(
    {} as never, // kafka 不碰
    m.prisma as never,
    m.parser as never,
    m.vectorGateway as never,
    m.taskLog as never,
    m.qualityDetector as never,
    m.parentBlockService as never,
    m.keywordIndex as never,
    m.configAdvisor as never,
    m.strategyExecutor as never,
    m.lockService as never,
    m.documentProducer as never,
    m.documentProfileService as never,
    'document-parse',
    'group-id',
  )
}

describe('DocumentParseConsumer', () => {
  let m: ReturnType<typeof makeMocks>
  let consumer: DocumentParseConsumer
  /** 调 private handle 的便捷封装 */
  const call = (payload: object) =>
    (consumer as unknown as { handle: (raw: string) => Promise<void> }).handle(JSON.stringify(payload))

  beforeEach(() => {
    m = makeMocks()
    consumer = makeConsumer(m)
  })

  it('INDEXED 幂等短路：不跑流水线、释放锁、不抛错', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc({ status: DocumentStatus.INDEXED }))

    await call({ docId: DOC_ID }) // 无 config

    // 流水线阶段全没调
    expect(m.parser.parse).not.toHaveBeenCalled()
    expect(m.strategyExecutor.execute).not.toHaveBeenCalled()
    expect(m.vectorGateway.write).not.toHaveBeenCalled()
    // configAdvisor 也没调（短路在它之前）
    expect(m.configAdvisor.loadOrRecommend).not.toHaveBeenCalled()
    // 锁被释放（forceRelease：合法持有方无条件释放）
    expect(m.lockService.forceRelease).toHaveBeenCalledWith(DOC_ID)
    // 不抛错
    expect(m.prisma.document.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: DocumentStatus.FAILED }),
    }))
  })

  it('文档不存在：安静跳过、不跑流水线、不 rethrow（避免 Kafka 无限重投）', async () => {
    // findUnique 返回 null（文档被删 / 脏消息）
    m.prisma.document.findUnique.mockResolvedValue(null)

    await call({ docId: '不存在的-doc' })

    // 流水线全没调
    expect(m.configAdvisor.loadOrRecommend).not.toHaveBeenCalled()
    expect(m.parser.parse).not.toHaveBeenCalled()
    expect(m.strategyExecutor.execute).not.toHaveBeenCalled()
    // 不写 FAILED 状态（文档都没了，没必要 update）
    expect(m.prisma.document.update).not.toHaveBeenCalled()
    // 不写 taskLog
    expect(m.taskLog.write).not.toHaveBeenCalled()
  })

  it('LOW 质量分支：status=FAILED + taskLog.write、不 rethrow、后续阶段不调', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('解析后的文本')
    m.qualityDetector.detect.mockResolvedValue('LOW')

    await call({ docId: DOC_ID })

    // status=FAILED
    expect(m.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOC_ID }, data: expect.objectContaining({ status: DocumentStatus.FAILED, quality: 'LOW' }) }),
    )
    // taskLog.write 被调（FAILED + 提示文案）
    expect(m.taskLog.write).toHaveBeenCalledWith(DOC_ID, 'PARSE', 'FAILED', expect.any(String))
    // 后续阶段不调（LOW 短路 return）
    expect(m.strategyExecutor.execute).not.toHaveBeenCalled()
    expect(m.vectorGateway.write).not.toHaveBeenCalled()
    expect(m.parentBlockService.build).not.toHaveBeenCalled()
  })

  it('happy path：六阶段按序调用 + status=INDEXED + tokenCount=ceil(len/4)', async () => {
    const text = 'a'.repeat(100) // len=100 → tokenCount=ceil(100/4)=25
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue(text)
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    // ：execute 返回 { chunks, headings }（RECURSIVE 路径无 headings）
    m.strategyExecutor.execute.mockResolvedValue({ chunks: [{ index: 0, content: text }], headings: [] })

    await call({ docId: DOC_ID })

// 八阶段 stage 名按序（加 STRUCTURE_NODE + PROFILE，都走 stage 包裹）
    const stages = m.taskLog.stage.mock.calls.map((c) => c[1])
    expect(stages).toEqual(['PARSE', 'CHUNK', 'STRUCTURE_NODE', 'VECTORIZE', 'PARENT_BLOCK', 'KEYWORD_INDEX', 'PROFILE'])
    // status=INDEXED + tokenCount
    expect(m.prisma.document.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: DOC_ID },
        data: expect.objectContaining({ status: DocumentStatus.INDEXED, tokenCount: 25, charCount: 100 }),
      }),
    )
    // taskLog.write 没被调（无失败）
    expect(m.taskLog.write).not.toHaveBeenCalled()
  })

  it('阶段抛错（retryCount=0）→ 重发消息 retryCount=1，不标 FAILED 不 rethrow', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('text')
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    const boom = new Error('切块炸了')
    m.strategyExecutor.execute.mockRejectedValue(boom)

    // ：retryCount < MAX_RETRY 不 rethrow（让 kafka commit 出队，避免旧消息无限重投）
    await expect(call({ docId: DOC_ID })).resolves.toBeUndefined()

    // 重发消息 retryCount=1（document-parse topic → sendParse）
    expect(m.documentProducer.sendParse).toHaveBeenCalledWith(DOC_ID, 1)
    // 标 PARSING（展示态，还有重试机会）+ errorCode=PIPELINE_ERROR + errorMsg 带阶段名和重试计数
    expect(m.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DOC_ID },
        data: expect.objectContaining({
          status: DocumentStatus.PARSING,
          errorCode: 'PIPELINE_ERROR',
          errorMsg: expect.stringContaining('[CHUNK]'),
        }),
      }),
    )
    // taskLog.write 带重试计数
    expect(m.taskLog.write).toHaveBeenCalledWith(DOC_ID, 'FAILED_STAGE', 'FAILED', expect.stringContaining('[retry 1/3]'))
  })

  it('重试耗尽（retryCount=3）→ 标 FAILED MAX_RETRY_EXCEEDED，不 rethrow 停投', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('text')
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    m.strategyExecutor.execute.mockRejectedValue(new Error('切块炸了'))

    // retryCount=3 已达上限 → 标 FAILED 停投，不 rethrow
    await expect(call({ docId: DOC_ID, retryCount: 3 })).resolves.toBeUndefined()

    // 不重发（已达上限）
    expect(m.documentProducer.sendParse).not.toHaveBeenCalled()
    // 标 FAILED + errorCode=MAX_RETRY_EXCEEDED
    expect(m.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DOC_ID },
        data: expect.objectContaining({
          status: DocumentStatus.FAILED,
          errorCode: 'MAX_RETRY_EXCEEDED',
        }),
      }),
    )
    expect(m.taskLog.write).toHaveBeenCalledWith(DOC_ID, 'FAILED_STAGE', 'FAILED', expect.stringContaining('重试已达上限'))
  })

  it('finally 必释放锁：happy path 后也调 forceRelease', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('text')
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    m.strategyExecutor.execute.mockResolvedValue([{ index: 0, content: 'text' }])

    await call({ docId: DOC_ID })

    expect(m.lockService.forceRelease).toHaveBeenCalledWith(DOC_ID)
  })

  it('finally 必释放锁：失败重发路径也调 forceRelease', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('text')
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    m.strategyExecutor.execute.mockRejectedValue(new Error('boom'))

    // ：失败不 rethrow（重发消息），但 finally 仍执行释放锁
    await expect(call({ docId: DOC_ID })).resolves.toBeUndefined()

    expect(m.lockService.forceRelease).toHaveBeenCalledWith(DOC_ID)
  })

  it('释放锁抛错（Redis 不可用）不影响主流程：happy path 仍完成', async () => {
    m.prisma.document.findUnique.mockResolvedValue(makeDoc())
    m.configAdvisor.loadOrRecommend.mockResolvedValue({ chunkSize: 800, overlap: 120, pipeline: ['RECURSIVE'] })
    m.parser.parse.mockResolvedValue('text')
    m.qualityDetector.detect.mockResolvedValue('GOOD')
    m.strategyExecutor.execute.mockResolvedValue({ chunks: [{ index: 0, content: 'text' }], headings: [] })
    // forceRelease 内部吞错语义由 ReindexLockService 保证；这里模拟其 Redis 调用抛错（等价层）
    m.lockService.forceRelease.mockRejectedValue(new Error('redis down'))

    // 不应抛错（吞 catch 语义）
    await call({ docId: DOC_ID })

    // 主流程仍完成（status=INDEXED）
    expect(m.prisma.document.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: DocumentStatus.INDEXED }) }),
    )
  })
})
