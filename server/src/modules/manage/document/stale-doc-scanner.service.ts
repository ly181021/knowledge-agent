/**
 * StaleDocScannerService —— 滞留文档补偿扫描
 * 痛点：upload 同步 await sendParse，若 Kafka 发送失败/消息丢失，文档永远卡在 status=PARSING。
 * 对策：@Interval 每 5 分钟扫描 status=PARSING 的文档，按滞留时长重投或标 FAILED。
 * 策略（阈值留足余量，避免误判正常处理中的大文档）：
 *   < 10min    → 不动（正常处理中，向量化 batch=32 并发 3 路几分钟内完成）
 *   10-15min   → 重投 sendParse（窗口期 5min + 周期 5min，同一文档最多约 2 次；consumer 幂等无副作用）
 *   > 15min    → 标记 FAILED + 写 taskLog（补偿扫描：解析超时）
 * 只扫 PARSING，不扫 INDEXING（那是 reindex 中间态，有 ReindexLockService 双层锁保护）。
 * 重投用 sendParse（document-parse topic），不依赖锁——consumer 的先 deleteMany + INDEXED 短路保证幂等。
 */
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { DocumentStatus } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'
import { DocumentProducer } from './mq/document-producer'
import { TaskLogService, STAGE } from './task-log.service'
import { ERROR_CODE } from './document-parse-stage'

/** 滞留阈值 */
const STALE_RESEND_MS = 10 * 60 * 1000 // 10 分钟：进入重投窗口
const STALE_FAIL_MS = 15 * 60 * 1000 // 15 分钟：标记 FAILED
/** 扫描周期 */
const SCAN_INTERVAL_MS = 5 * 60 * 1000 // 每 5 分钟扫一次

@Injectable()
export class StaleDocScannerService {
  private readonly logger = new Logger(StaleDocScannerService.name)

  constructor(
    private prisma: PrismaService,
    private documentProducer: DocumentProducer,
    private taskLog: TaskLogService,
  ) {}

  /**
   * 补偿扫描入口。
   * 双参数 @Interval（name, timeout）：兼容任何 @nestjs/schedule 版本（单参数在老版 v4.x 会被当作 name），
   * 且能在 SchedulerRegistry 里按名 'stale-doc-scan' 查询/停启。
   * 单次异常由 @nestjs/schedule 6.1.3 的 explorer try/catch 包裹（logger.error 后继续，不崩进程）。
   */
  @Interval('stale-doc-scan', SCAN_INTERVAL_MS)
  async scan(): Promise<void> {
    const now = Date.now()
    const resendBefore = new Date(now - STALE_RESEND_MS) // updatedAt 早于此 = 滞留 > 10min
    const failBefore = new Date(now - STALE_FAIL_MS) // updatedAt 早于此 = 超龄 > 15min

    // 1. 超龄（> 15min）→ 标 FAILED + 写 taskLog（仿 consumer 的 FAILED 分支）
    const overage = await this.prisma.document.findMany({
      where: { status: DocumentStatus.PARSING, updatedAt: { lt: failBefore } },
      select: { id: true, title: true },
    })
    for (const doc of overage) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.FAILED, errorCode: ERROR_CODE.PARSE_TIMEOUT, errorMsg: '补偿扫描：解析超时（超过15分钟未完成）' },
      })
      await this.taskLog.write(doc.id, STAGE.PARSE, 'FAILED', '补偿扫描：解析超时（超过15分钟未完成）')
      this.logger.warn(`[stale-scan] 标记 FAILED: doc=${doc.id} title=${doc.title}（超时未完成解析）`)
    }

    // 2. 滞留（10-15min）→ 重投 Kafka
    // consumer 幂等（先 deleteMany 清残留 + INDEXED 短路），重投安全；sendParse 不依赖锁
    const stale = await this.prisma.document.findMany({
      where: {
        status: DocumentStatus.PARSING,
        updatedAt: { gte: resendBefore, lt: failBefore },
      },
      select: { id: true, title: true },
    })
    for (const doc of stale) {
      try {
        await this.documentProducer.sendParse(doc.id)
        this.logger.log(`[stale-scan] 重投 Kafka: doc=${doc.id} title=${doc.title}（滞留10-15分钟）`)
      } catch (e) {
        // Kafka 仍不可用：不标 FAILED（下个周期可能恢复），只记 warn；到 15min 才标 FAILED
        this.logger.warn(
          `[stale-scan] 重投失败 doc=${doc.id}: ${e instanceof Error ? e.message : String(e)}（等下个周期重试）`,
        )
      }
    }

    if (overage.length > 0 || stale.length > 0) {
      this.logger.log(`[stale-scan] 扫描完成：标FAILED=${overage.length} 重投=${stale.length}`)
    }
  }
}
