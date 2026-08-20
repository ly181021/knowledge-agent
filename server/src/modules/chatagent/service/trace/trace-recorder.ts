/**
 * TraceRecorder —— 全链路 trace +  trace/trace-recorder.ts
 * 在 chat 流程中写 trace 表
 * - startExchange: 建 ChatExchange
 * - recordRetrieval: 批量建 ChannelExecution + RetrievalResult
 * - recordModelUsage: 建 ChatModelUsageTrace
 * - finishExchange: 更新 ChatExchange.answer + durationMs
 */
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { Prisma } from '@prisma/client'
import { ExecutionMode } from '@/common/enums/execution-mode'
import type { ExecutorChannelStat, ExecutorChunkScore } from '@/modules/chatagent/ai/execution-plan'
import type { ProgressEvent } from '@/modules/chatagent/ai/progress-emitter'

@Injectable()
export class TraceRecorder {
  private readonly logger = new Logger(TraceRecorder.name)

  constructor(private prisma: PrismaService) {}

  /** 建一行 ChatExchange，返回 exchangeId */
  async startExchange(sessionId: string, question: string, mode: ExecutionMode): Promise<string> {
    const exchange = await this.prisma.chatExchange.create({
      data: {
        sessionId,
        question,
        answer: '',           // 答完后 finishExchange 更新
        executionMode: mode,
      },
    })
    this.logger.debug(`startExchange: ${exchange.id} mode=${mode}`)
    return exchange.id
  }

  /** 批量建 ChannelExecution + RetrievalResult */
  async recordRetrieval(
    exchangeId: string,
    sessionId: string,
    channels: ExecutorChannelStat[],
    results: ExecutorChunkScore[],
  ): Promise<void> {
    // ChannelExecution
    for (const ch of channels) {
      await this.prisma.channelExecution.create({
        data: {
          exchangeId,
          channel: ch.channel,
          recalled: ch.recalled,
          accepted: ch.accepted,
          durationMs: ch.durationMs ?? null,
        },
      })
    }

    // RetrievalResult
    for (const r of results) {
      await this.prisma.retrievalResult.create({
        data: {
          exchangeId,
          docId: r.documentId,
          chunkId: r.chunkId,
          chunkContent: undefined,
          vectorScore: r.vectorScore ?? null,
          keywordScore: r.keywordScore ?? null,
          rrfScore: r.rrfScore,
          rerankScore: r.rerankScore ?? null,
          accepted: r.accepted,
          rank: r.rank,
        },
      })
    }
    this.logger.debug(`recordRetrieval: ${channels.length} channels, ${results.length} results`)
  }

  /** 建 ChatModelUsageTrace */
  async recordModelUsage(
    exchangeId: string,
    model: string,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
    durationMs?: number,
  ): Promise<void> {
    await this.prisma.chatModelUsageTrace.create({
      data: {
        exchangeId,
        model,
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        durationMs: durationMs ?? null,
      },
    })
  }

  /** 更新 ChatExchange.answer + durationMs */
  async finishExchange(exchangeId: string, answer: string, durationMs: number): Promise<void> {
    await this.prisma.chatExchange.update({
      where: { id: exchangeId },
      data: { answer, durationMs },
    })
    this.logger.debug(`finishExchange: ${exchangeId} durationMs=${durationMs}`)
  }

  /**
   * 记一条工具调用（ReAct 工具 trace，写 ChatToolTrace 表）
   * fire-and-forget：不 await（参考 recordStage 范式），DB 写失败只 warn，不阻塞主链路
   */
  recordTool(exchangeId: string, toolCall: { toolName: string; args?: unknown }, result?: unknown, durationMs?: number): void {
    this.prisma.chatToolTrace
      .create({
        data: {
          exchangeId,
          toolName: toolCall.toolName,
          input: (toolCall.args ?? undefined) as Prisma.InputJsonValue | undefined,
          output: result as Prisma.InputJsonValue | undefined,
          durationMs,
        },
      })
      .catch((e) => {
        this.logger.warn(`recordTool failed tool=${toolCall.toolName}: ${e instanceof Error ? e.message : String(e)}`)
      })
  }

  /**
   * 会话累计用量（ReAct 第三层熔断预检）
   * modelCalls 排除 model='recommendation'（每 exchange 有 2 条 usage trace，不排除会翻倍误触发）；
   * 设计为 onFinish 记一次累计 usage，所以行数 = exchange 数 = 模型调用轮次
   */
  async countSessionUsage(sessionId: string): Promise<{ modelCalls: number; toolCalls: number }> {
    const [modelCalls, toolCalls] = await Promise.all([
      this.prisma.chatModelUsageTrace.count({
        where: { model: { not: 'recommendation' }, exchange: { sessionId } },
      }),
      this.prisma.chatToolTrace.count({
        where: { exchange: { sessionId } },
      }),
    ])
    return { modelCalls, toolCalls }
  }

  /**
   * 记录单个责任链/执行器步骤到 TraceStage 表（fire-and-forget）
   * 不 await：DB 写失败只 warn，不阻塞主链路 / SSE 帧
   */
  recordStage(sessionId: string, exchangeId: string | null, event: ProgressEvent): void {
    const payload = event.payload ?? {}
    const state = payload.error ? 'error' : payload.skipped ? 'skipped' : 'done'
    const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null

    this.prisma.traceStage
      .create({
        data: {
          sessionId,
          exchangeId,
          stage: event.step,
          state,
          input: undefined,
          output: payload as unknown as Prisma.InputJsonValue,
          durationMs,
          endedAt: new Date(),
        },
      })
      .catch((e) => {
        this.logger.warn(
          `recordStage failed stage=${event.step}: ${e instanceof Error ? e.message : String(e)}`,
        )
      })
  }
}
