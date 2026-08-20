/**
 * NoneMemory —— 无记忆策略
 * load 返回 []（每轮独立，不携带历史）；append 仍落库（会话历史  依赖 Message 表）
 */
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { ChatMemory, ChatMemoryMessage, MemoryMeta } from './chat-memory'

@Injectable()
export class NoneMemory implements ChatMemory {
  private readonly logger = new Logger(NoneMemory.name)

  constructor(private prisma: PrismaService) {}

  async load(_sessionId: string): Promise<ChatMemoryMessage[]> {
    // 无记忆：不携带任何历史
    return []
  }

  async append(sessionId: string, message: ChatMemoryMessage, meta?: MemoryMeta): Promise<void> {
    // 落库保会话历史，但不触发摘要压缩
    await this.prisma.message.create({
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        tokenCount: meta?.tokenCount ?? null,
        toolCalls: meta?.toolCalls ? JSON.stringify(meta.toolCalls) : undefined,
      },
    })
    this.logger.debug(`none-memory append session=${sessionId} role=${message.role}`)
  }
}
