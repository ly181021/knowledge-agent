/**
 * SlidingWindowMemory —— 最近 N 轮原文（history-preview-turns=4，take=8 条）
 */
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { ChatMemory, ChatMemoryMessage, MemoryMeta } from './chat-memory'
import { toMemoryMessage, trimToChars } from './chat-memory'

/** 保留最近 4 轮 = 8 条消息 */
const WINDOW_SIZE = 8

@Injectable()
export class SlidingWindowMemory implements ChatMemory {
  private readonly logger = new Logger(SlidingWindowMemory.name)

  constructor(private prisma: PrismaService) {}

  async load(sessionId: string): Promise<ChatMemoryMessage[]> {
    const msgs = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: WINDOW_SIZE,
    })
    // 反转为正序 + 按 2200 字符预算截断（与 SummaryMemory 一致）
    return trimToChars(msgs.reverse()).map(toMemoryMessage)
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
    this.logger.debug(`append message session=${sessionId} role=${message.role} len=${message.content.length}`)
  }
}
