/**
 * SummaryProducer —— 摘要压缩触发
 * topic=summary-merge，key=sessionId 保证同会话顺序消费
 * 延迟 5s 语义由消费端 sleep 承担（Kafka 无原生延迟）
 */
import { Injectable, Logger } from '@nestjs/common'
import { KafkaService } from '@/modules/infra/kafka.provider'

@Injectable()
export class SummaryProducer {
  private readonly logger = new Logger(SummaryProducer.name)

  constructor(private kafka: KafkaService) {}

  /** 触发摘要压缩 */
  async enqueueMerge(sessionId: string): Promise<void> {
    await this.kafka.send('summary-merge', { key: sessionId, value: JSON.stringify({ sessionId }) })
    this.logger.debug(`summary-merge enqueued: session=${sessionId}`)
  }
}
