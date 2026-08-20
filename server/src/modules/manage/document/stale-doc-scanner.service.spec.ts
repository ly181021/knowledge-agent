/**
 * StaleDocScannerService 单测 —— 滞留文档补偿扫描
 * 覆盖 4 个分支：
 * - 正常文档（< 10min）：不动，sendParse 未调
 * - 滞留（10-15min）：sendParse 被调
 * - 超龄（> 15min）：update FAILED + taskLog.write 被调
 * - 重投失败：sendParse reject → 不抛错，不标 FAILED
 * 风格：手写 mock + 直接 new（项目惯例，见 document-parse.consumer.spec.ts）。
 */
import { DocumentStatus } from '@prisma/client'
import { StaleDocScannerService } from './stale-doc-scanner.service'

/** 构造 mock 依赖 */
function makeMocks() {
  return {
    prisma: {
      document: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    },
    documentProducer: {
      sendParse: jest.fn().mockResolvedValue(undefined),
    },
    taskLog: {
      write: jest.fn().mockResolvedValue(undefined),
    },
  }
}

/** 构造 scanner 实例 */
function makeScanner(m: ReturnType<typeof makeMocks>) {
  return new StaleDocScannerService(
    m.prisma as never,
    m.documentProducer as never,
    m.taskLog as never,
  )
}

describe('StaleDocScannerService', () => {
  let m: ReturnType<typeof makeMocks>
  let scanner: StaleDocScannerService

  beforeEach(() => {
    m = makeMocks()
    scanner = makeScanner(m)
  })

  it('无滞留文档（findMany 返回空）：不调 sendParse / update / write', async () => {
    m.prisma.document.findMany.mockResolvedValue([])

    await scanner.scan()

    expect(m.documentProducer.sendParse).not.toHaveBeenCalled()
    expect(m.prisma.document.update).not.toHaveBeenCalled()
    expect(m.taskLog.write).not.toHaveBeenCalled()
  })

  it('超龄文档（> 15min）：标记 FAILED + 写 taskLog', async () => {
    // 第一次 findMany（超龄查询）返回 1 条；第二次（滞留查询）返回空
    m.prisma.document.findMany
      .mockResolvedValueOnce([{ id: 'doc-overage', title: '旧文档' }])
      .mockResolvedValueOnce([])

    await scanner.scan()

    // update status=FAILED + errorCode=PARSE_TIMEOUT + errorMsg（状态机）
    expect(m.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-overage' },
      data: { status: DocumentStatus.FAILED, errorCode: 'PARSE_TIMEOUT', errorMsg: expect.stringContaining('解析超时') },
    })
    // taskLog.write FAILED + 超时说明
    expect(m.taskLog.write).toHaveBeenCalledWith(
      'doc-overage',
      'PARSE',
      'FAILED',
      expect.stringContaining('解析超时'),
    )
    // 不重投（超龄是标 FAILED，不是重投）
    expect(m.documentProducer.sendParse).not.toHaveBeenCalled()
  })

  it('滞留文档（10-15min）：重投 sendParse', async () => {
    // 第一次（超龄）空；第二次（滞留）返回 1 条
    m.prisma.document.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'doc-stale', title: '滞留文档' }])

    await scanner.scan()

    expect(m.documentProducer.sendParse).toHaveBeenCalledWith('doc-stale')
    // 不标 FAILED
    expect(m.prisma.document.update).not.toHaveBeenCalled()
    expect(m.taskLog.write).not.toHaveBeenCalled()
  })

  it('重投失败（sendParse reject）：不抛错、不标 FAILED', async () => {
    m.prisma.document.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'doc-kafka-down', title: 'Kafka挂了' }])
    m.documentProducer.sendParse.mockRejectedValue(new Error('Kafka broker unavailable'))

    // 不应抛错（记 warn，等下个周期重试）
    await expect(scanner.scan()).resolves.not.toThrow()

    // 重投被尝试了
    expect(m.documentProducer.sendParse).toHaveBeenCalledWith('doc-kafka-down')
    // 但没标 FAILED（Kafka 可能下个周期恢复，到 15min 才标）
    expect(m.prisma.document.update).not.toHaveBeenCalled()
  })
})
