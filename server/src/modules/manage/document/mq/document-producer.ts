/**
 * DocumentProducer —— 文档流水线触发
 * topic：document-parse（上传后解析）/ document-index（reindex 重建）
 * key = docId：同一文档的消息落同一 partition 且顺序消费（幂等设计前提）
 */
import { Injectable, Logger } from '@nestjs/common'
import { KafkaService } from '@/modules/infra/kafka.provider'

/** 按文档索引配置（建表，见；schema 未建前先以宽松类型占位） */
export interface DocumentIndexConfigInput {
  chunkSize?: number
  overlap?: number
  strategy?: string
}

@Injectable()
export class DocumentProducer {
  private readonly logger = new Logger(DocumentProducer.name)

  constructor(private kafka: KafkaService) {}

  /**
   * 上传后触发解析（parse-topic）
   * @param retryCount 应用层重投计数（consumer 失败时重发带 +1 的消息，超限停止）
   */
  async sendParse(docId: string, retryCount = 0): Promise<void> {
    await this.kafka.send('document-parse', { key: docId, value: JSON.stringify({ docId, retryCount }) })
    this.logger.log(`document-parse enqueued: doc=${docId}${retryCount > 0 ? ` retry=${retryCount}` : ''}`)
  }

  /**
   * reindex 触发重建（index-topic），config 覆盖默认切块配置（按文档配置生效）
   * @param retryCount 应用层重投计数（同 sendParse）
   */
  async sendIndex(docId: string, config?: DocumentIndexConfigInput, retryCount = 0): Promise<void> {
    await this.kafka.send('document-index', { key: docId, value: JSON.stringify({ docId, config, retryCount }) })
    this.logger.log(`document-index enqueued: doc=${docId}${retryCount > 0 ? ` retry=${retryCount}` : ''}`)
  }
}
