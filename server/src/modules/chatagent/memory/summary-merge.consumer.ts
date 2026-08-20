/**
 * SummaryMergeConsumer —— 异步摘要压缩
 * 延迟语义：Kafka 无原生延迟，消费端先 sleep(5000) 再处理（等本轮消息写完、滑窗稳定后再压缩）
 * 失败策略：压缩失败 吞异常不 rethrow（→ commit → 不重投）——摘要压缩失败重投无收益（upsert 覆盖、下次触发会重压），
 *   与文档流水线 consumer（rethrow 触发重投）不同，异常吞掉直接 commit 出队
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { generateText } from 'ai'
import { KafkaService } from '@/modules/infra/kafka.provider'
import { LlmService } from '@/modules/infra/llm.provider'
import { PrismaService } from '@/prisma/prisma.service'
import { renderPrompt } from '@/modules/chatagent/prompts/render'
import type { Message } from '@prisma/client'

/** 延迟 5 秒（等本轮消息写完、滑窗稳定后再压缩） */
const DELAY_MS = 5000

@Injectable()
export class SummaryMergeConsumer implements OnModuleInit {
  private readonly logger = new Logger(SummaryMergeConsumer.name)

  constructor(
    private kafka: KafkaService,
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  onModuleInit() {
    // 注册失败/运行期断开的无限重试由 KafkaService.consume 内部负责（指数退避），无需在此 catch
    void this.kafka.consume('summary-merge', this.kafka.groupId('summary-merge'), async (raw) => {
      const { sessionId } = JSON.parse(raw) as { sessionId: string }
      await new Promise((r) => setTimeout(r, DELAY_MS))
      await this.merge(sessionId)
    })
  }

/** 压缩逻辑（增量游标：只压缩游标之后的新增消息，成本固定） */
  async merge(sessionId: string): Promise<void> {
    try {
      // 0. 取既有摘要（含增量游标 lastCompressedAt；null = 从未压缩，首次全量）
      const summary = await this.prisma.memorySummary.findFirst({
        where: { sessionId },
        orderBy: { version: 'desc' },
      })

      // 1. 增量窗口：只取游标之后的消息（仍跳过最近 8 条原文，最多推进 6 轮 = 12 条新增）
      const overflow: Message[] = await this.prisma.message.findMany({
        where: {
          sessionId,
          ...(summary?.lastCompressedAt ? { createdAt: { gt: summary.lastCompressedAt } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip: 8,
        take: 12,
      })

      if (overflow.length === 0) {
        this.logger.debug('summary-merge: no overflow messages, skipping')
        return
      }

      // 反转成正序
      overflow.reverse()

      // 2. 拼接对话文本
      const conversationText = overflow
        .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
        .join('\n\n')

      // 3. LLM 压缩
      const prompt = renderPrompt('conversation-summary-merge', {
        previous_summary: summary?.content ?? '（无）',
        conversation: conversationText,
      })

      const { text } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是对话摘要助手，只返回摘要正文，不要解释。',
        prompt,
      })

      // 4. upsert MemorySummary（version 自增 + 游标推进 = overflow 最晚消息的 createdAt）
      //    边界：压缩失败 → catch 吞异常、游标不更新 → 重试重压同一批（upsert 覆盖，可接受）
      const lastCompressedAt = overflow.at(-1)!.createdAt
      if (summary) {
        await this.prisma.memorySummary.update({
          where: { id: summary.id },
          data: { content: text.slice(0, 1400), version: { increment: 1 }, lastCompressedAt },
        })
      } else {
        await this.prisma.memorySummary.create({
          data: { sessionId, content: text.slice(0, 1400), version: 1, lastCompressedAt },
        })
      }

      this.logger.log(`summary-merge done: session=${sessionId} overflow=${overflow.length} summaryLen=${text.length}`)
    } catch (e) {
      // 吞异常：不 rethrow → commit → 不重投（重投无收益；下次触发会重新压缩）
      this.logger.error(`summary-merge failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
