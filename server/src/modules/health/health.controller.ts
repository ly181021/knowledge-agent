/**
 * HealthController —— K8s/docker 健康探针
 * 两个端点（均无 /api/v1 前缀，加在 main.ts 全局前缀 exclude 里）：
 * - GET /live  进程存活探针：只看进程能否响应，不查依赖。K8s livenessProbe 用，失败→重启 pod
 * - GET /ready 依赖就绪探针：查 MySQL/PG/Redis/Kafka/MinIO。K8s readinessProbe 用，失败→摘流量但不重启
 * 设计要点：
 * 1. @Public 豁免 JWT —— 探针不带 token，否则被 JwtAuthGuard 401 拦死
 * 2. 用 @Res 手动控制 HTTP 状态码 —— K8s 只看状态码（200=健康，503=不健康）。
 *    terminus 的 @HealthCheck 抛异常机制会被全局 HttpExceptionFilter 接住、丢失 details，
 *    故此处自行编排探活函数，避开异常链。
 * 3. 不走 TransformInterceptor 的 ApiResponse 包装 —— 用 @Res 直接写响应体，
 *    返回 undefined，TransformInterceptor 透传（见 transform.interceptor.ts）。
 */
import { Controller, Get, Res, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { Public } from '@/common/decorators/public.decorator'
import { PrismaService } from '@/prisma/prisma.service'
import { RedisService } from '@/modules/infra/redis.provider'
import { MinioService } from '@/modules/infra/minio.provider'
import { KafkaService } from '@/modules/infra/kafka.provider'

/** 单个依赖的探活结果 */
interface ProbeResult {
  status: 'up' | 'down'
  /** 耗时 ms，便于看哪个依赖慢 */
  durationMs?: number
  /** down 时的错误信息 */
  message?: string
}

/** 探活带超时包装：超时算 down，不让单个依赖拖垮整个探针 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    // 探活先完成时清掉 timer，避免每次探针泄漏一个挂起的定时器
    if (timer) clearTimeout(timer)
  }
}

@ApiTags('health')
@Public()
@Controller()
export class HealthController {
  private readonly logger = new Logger('HealthController')

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly minio: MinioService,
    private readonly kafka: KafkaService,
    private readonly config: ConfigService,
  ) {}

  /** 进程存活：能响应即存活，不查依赖（K8s livenessProbe 用）
   *  与 ready 一致用 @Res 直接写响应体，避开 TransformInterceptor 的 ApiResponse 包装 */
  @Get('live')
  @ApiOperation({ summary: '进程存活探针（liveness，不查依赖）' })
  live(@Res() res: Response): void {
    res.status(200).json({ status: 'ok', timestamp: Date.now() })
  }

  /** 依赖就绪：查全部依赖，任一 down 返回 503（K8s readinessProbe 用） */
  @Get('ready')
  @ApiOperation({ summary: '依赖就绪探针（readiness，查 MySQL/PG/Redis/Kafka/MinIO）' })
  async ready(@Res() res: Response): Promise<void> {
    const info: Record<string, ProbeResult> = {}

    // 五个依赖并行探活，互不阻塞（任一慢/挂不影响其它结果）
    const [mysql, pg, redis, kafka, minio] = await Promise.all([
      this.probeMysql(),
      this.probePg(),
      this.probeRedis(),
      this.probeKafka(),
      this.probeMinio(),
    ])
    Object.assign(info, { mysql, pg, redis, kafka, minio })

    const allUp = Object.values(info).every((r) => r.status === 'up')
    const body = {
      status: allUp ? 'ok' : 'error',
      timestamp: Date.now(),
      info,
    }
    // K8s 靠 HTTP 状态码判定：全 up=200，任一 down=503
    res.status(allUp ? 200 : 503).json(body)
  }

  // ===== 各依赖探活：失败返回 {status:'down', message}，永不抛错（抛错会被 Promise.all 吞） =====

  private async probeMysql(): Promise<ProbeResult> {
    const t0 = Date.now()
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 5000)
      return { status: 'up', durationMs: Date.now() - t0 }
    } catch (e) {
      return { status: 'down', durationMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }
    }
  }

  private async probePg(): Promise<ProbeResult> {
    const t0 = Date.now()
    // pg 连接散落在 vector.channel / vector-gateway，项目无共享 PG client，
    // 这里临时建连探活（与现有代码一致，不引入共享 service）
    const { Client } = await import('pg')
    const pgUrl = this.config.get<string>('PG_URL')
    const client = new Client({ connectionString: pgUrl })
    try {
      await withTimeout(client.connect(), 5000)
      await client.query('SELECT 1')
      return { status: 'up', durationMs: Date.now() - t0 }
    } catch (e) {
      return { status: 'down', durationMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }
    } finally {
      await client.end().catch(() => undefined)
    }
  }

  private async probeRedis(): Promise<ProbeResult> {
    const t0 = Date.now()
    try {
      const pong = await withTimeout(this.redis.getClient().ping(), 3000)
      return { status: pong === 'PONG' ? 'up' : 'down', durationMs: Date.now() - t0, message: pong === 'PONG' ? undefined : `unexpected reply: ${pong}` }
    } catch (e) {
      return { status: 'down', durationMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }
    }
  }

  private async probeKafka(): Promise<ProbeResult> {
    const t0 = Date.now()
    try {
      const ok = await withTimeout(this.kafka.healthCheck(), 8000)
      return { status: ok ? 'up' : 'down', durationMs: Date.now() - t0, message: ok ? undefined : 'broker unreachable' }
    } catch (e) {
      return { status: 'down', durationMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }
    }
  }

  private async probeMinio(): Promise<ProbeResult> {
    const t0 = Date.now()
    try {
      const exists = await withTimeout(this.minio.getClient().bucketExists(this.minio.getBucket()), 5000)
      // bucket 不存在也是 down（配置错误或未初始化）
      return { status: exists ? 'up' : 'down', durationMs: Date.now() - t0, message: exists ? undefined : 'bucket not found' }
    } catch (e) {
      return { status: 'down', durationMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }
    }
  }
}
