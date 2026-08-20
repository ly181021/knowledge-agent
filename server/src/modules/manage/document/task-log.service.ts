/**
 * TaskLogService —— 文档流水线任务日志粒度化
 * 每阶段自动打点：RUNNING → fn → SUCCESS/FAILED（带 durationMs + percent）
 * percent 权重表（阶段累计值，前端进度条读最新一条 RUNNING 的 percent）：
 *   PARSE 10 / CHUNK 30 / STRUCTURE_NODE 45 / VECTORIZE 60 / PARENT_BLOCK 75 / KEYWORD_INDEX 90 / PROFILE 98 / 完成 100
 */
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { TaskStatus } from '@prisma/client'

/** stage 常量（对齐  枚举） */
export const STAGE = {
  PARSE: 'PARSE',
  CHUNK: 'CHUNK',
  STRUCTURE_NODE: 'STRUCTURE_NODE',
  PARENT_BLOCK: 'PARENT_BLOCK',
  VECTORIZE: 'VECTORIZE',
  KEYWORD_INDEX: 'KEYWORD_INDEX',
  PROFILE: 'PROFILE',
  FAILED_STAGE: 'FAILED_STAGE',
} as const

/** percent 权重（阶段累计值；加 STRUCTURE_NODE + PROFILE，权重重排） */
export const STAGE_PERCENT: Record<string, number> = {
  [STAGE.PARSE]: 10,
  [STAGE.CHUNK]: 30,
  [STAGE.STRUCTURE_NODE]: 45,
  [STAGE.VECTORIZE]: 60,
  [STAGE.PARENT_BLOCK]: 75,
  [STAGE.KEYWORD_INDEX]: 90,
  [STAGE.PROFILE]: 98,
}

@Injectable()
export class TaskLogService {
  constructor(private prisma: PrismaService) {}

  /** 每阶段打点：RUNNING → fn → SUCCESS/FAILED（带 durationMs + percent） */
  async stage<T>(documentId: string, stage: string, fn: () => Promise<T>): Promise<T> {
    const percent = STAGE_PERCENT[stage] ?? 0
    const startedAt = Date.now()
    await this.write(documentId, stage, 'RUNNING', undefined, percent)
    try {
      const result = await fn()
      await this.write(documentId, stage, 'SUCCESS', undefined, 100, Date.now() - startedAt)
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.write(documentId, stage, 'FAILED', msg, undefined, Date.now() - startedAt)
      throw e
    }
  }

  /** 写一条任务日志 */
  async write(
    documentId: string,
    stage: string,
    status: TaskStatus,
    message?: string,
    percent?: number,
    durationMs?: number,
  ): Promise<void> {
    await this.prisma.documentTaskLog.create({
      data: { documentId, stage, status, message, percent, durationMs },
    })
  }

  /** 查询某文档的全部任务日志（按时间正序，供详情页 04 任务记录 + 02 进度条轮询） */
  async list(documentId: string) {
    return this.prisma.documentTaskLog.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    })
  }
}
