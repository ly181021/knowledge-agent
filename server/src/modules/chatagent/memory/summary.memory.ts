/**
 * SummaryMemory —— 摘要压缩记忆
 * load：最近 4 轮原文（8 条）+ MemorySummary 摘要（system 消息）
 * append：存消息后，如果 message count > 8 则入队 summary-merge 异步压缩
 */
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { ChatMemory, ChatMemoryMessage, MemoryMeta } from './chat-memory'
import { toMemoryMessage, trimToChars } from './chat-memory'
import { SummaryProducer } from './summary-producer'

/** 保留最近 4 轮 = 8 条消息 */
const WINDOW_SIZE = 8

@Injectable()
export class SummaryMemory implements ChatMemory {
  private readonly logger = new Logger(SummaryMemory.name)

  constructor(
    private prisma: PrismaService,
    private summaryProducer: SummaryProducer,
  ) {}

  async load(sessionId: string): Promise<ChatMemoryMessage[]> {
    // 1. 取长期摘要（如有）
    const summary = await this.prisma.memorySummary.findFirst({
      where: { sessionId },
      orderBy: { version: 'desc' },
    })

    // 2. 取最近 4 轮原文，按 2200 字符预算截断（最近消息优先，超预算截断）
    const recent = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: WINDOW_SIZE,
    })

    // 组装：摘要在前（system），原文在后
    const result: ChatMemoryMessage[] = []
    if (summary) {
      result.push({ role: 'system', content: `之前的对话摘要：${summary.content}` })
    }
    result.push(...trimToChars(recent.reverse()).map(toMemoryMessage))

    return result
  }

  async append(sessionId: string, message: ChatMemoryMessage, meta?: MemoryMeta): Promise<void> {
    await this.prisma.message.create({
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        tokenCount: meta?.tokenCount ?? null,
        toolCalls: meta?.toolCalls ? JSON.stringify(meta.toolCalls) : undefined,
        citations: meta?.citations ? JSON.stringify(meta.citations) : undefined,
        recommendations: meta?.recommendations ? JSON.stringify(meta.recommendations) : undefined,
      },
    })

    // 超过滑窗则异步触发摘要压缩
    const count = await this.prisma.message.count({ where: { sessionId } })
    if (count > WINDOW_SIZE) {
      await this.summaryProducer.enqueueMerge(sessionId)
      this.logger.debug(`append: session=${sessionId} count=${count} > ${WINDOW_SIZE}, enqueued summary-merge`)
    }
  }
}
