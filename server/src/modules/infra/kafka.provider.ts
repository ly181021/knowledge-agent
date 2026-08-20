/**
 * Kafka Provider
 * kafkajs 封装：producer.send + consumer 订阅 helper（手动 commit）
 * 消费语义：handler 抛错 → 不 commit → 该 offset 未提交，Kafka 重投（配合业务幂等跳过）
 * 手动 commit 用 autoCommit: false + eachMessage 成功后 commitOffsets
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Kafka, Producer, Consumer } from 'kafkajs'

export interface KafkaSendMessage {
  /** key 保证同一 key 的消息落同一 partition 且顺序消费 */
  key?: string
  value: string
}

/** consumer 注册重试退避：首次 1s，指数翻倍，封顶 30s */
const CONSUMER_RETRY_BASE_MS = 1000
const CONSUMER_RETRY_MAX_MS = 30000

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly logger = new Logger('KafkaService')
  private readonly kafka: Kafka
  private readonly producer: Producer
  private readonly consumers: Consumer[] = []
  private producerReady = false
  private destroying = false

  constructor(private config: ConfigService) {
    const brokers = (this.config.get<string>('KAFKA_BROKERS') ?? 'localhost:9092').split(',')
    this.kafka = new Kafka({
      clientId: this.config.get<string>('KAFKA_CLIENT_ID', 'knowledge-agent'),
      brokers,
    })
    this.producer = this.kafka.producer()
    this.producer.on('producer.connect', () => this.logger.log('Kafka producer connected'))
    this.producer.on('producer.disconnect', (e) => this.logger.warn(`Kafka producer disconnected: ${String(e)}`))
    this.logger.log(`KafkaService ready, brokers=${brokers.join(',')}`)
  }

  /** 发送单条消息 */
  async send(topic: string, message: KafkaSendMessage): Promise<void> {
    await this.ensureProducer()
    await this.producer.send({
      topic,
      messages: [{ key: message.key, value: message.value }],
    })
  }

  /**
   * 订阅并消费（手动 commit）
   * 连接策略：connect/subscribe/run 任一步失败、或运行期 CRASH/DISCONNECT，均指数退避无限重试——
   *   消费者必须最终注册成功：init 失败持续重试，否则 Kafka 后于后端启动时消费者永久失联，文档卡 PARSING。
   * 位点策略（显式决策）：fromBeginning=true —— 消费者组无已提交位点时从最早开始消费。
   *   任务型消息语义是至少一次投递，停机期积压必须补消费；三个 topic 的 handler 均幂等
   *   （文档流水线 INDEXED 短路 / pg ON CONFLICT upsert / 摘要增量游标），重放安全。
   * @param topic 订阅的 topic
   * @param groupId 消费者组 id（调用方按 ${KAFKA_GROUP_ID_PREFIX}-${topic} 传入）
   * @param handler 处理函数，抛错则本消息不 commit → 重投
   */
  async consume(topic: string, groupId: string, handler: (raw: string) => Promise<void>): Promise<void> {
    let attempt = 0
     
    while (true) {
      if (this.destroying) return
      attempt++
      const consumer: Consumer = this.kafka.consumer({
        groupId,
        retry: { retries: 2 }, // kafkajs 内部操作失败重试 2 次；整体恢复靠外层重连
      })
      this.consumers.push(consumer)
      const delay = Math.min(CONSUMER_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 5), CONSUMER_RETRY_MAX_MS)
      try {
        await consumer.connect()
        await consumer.subscribe({ topic, fromBeginning: true })
        await consumer.run({
          autoCommit: false, // 手动 commit：处理成功后显式 commitOffsets
          eachMessage: async ({ topic: t, partition, message, heartbeat }) => {
            const raw = message.value?.toString() ?? ''
            try {
              await handler(raw)
            } catch (e) {
              this.logger.error(
                `kafka consume failed topic=${t} group=${groupId} offset=${message.offset}: ${e instanceof Error ? e.message : String(e)}`,
              )
              throw e // 不 commit → 该 offset 未提交，重投（CRASH → 外层重连后自动重投）
            }
            // 手动 commit 必须提交 message.offset + 1：
            // kafkajs 的 eachMessage 成功后会自动调 resolveOffset（内部 offset+1 存进 resolvedOffsets），
            // 但 commitOffsets 用我们传入的值原样覆盖 resolvedOffsets（offsetManager:269-273）。
            // 若传 message.offset（未 +1），会覆盖 kafkajs 已 +1 的正确值 → 重启后重放最后一条消息。
            // 用 BigInt 避免 Number 在大 offset 时的精度损失（Kafka offset 是 int64）。
            const nextOffset = (BigInt(message.offset) + 1n).toString()
            await consumer.commitOffsets([{ topic: t, partition, offset: nextOffset }])
            await heartbeat()
          },
        })
        this.logger.log(`Kafka consumer ready: group=${groupId} topic=${topic}`)
        // run() 返回后消费循环在后台运行；等运行期断开事件（CRASH/DISCONNECT）再进入下一轮重连
        await this.waitForDisconnect(consumer)
        this.logger.warn(`Kafka consumer disconnected: group=${groupId} topic=${topic}, reconnecting`)
      } catch (e) {
        this.logger.warn(
          `Kafka consumer setup failed: group=${groupId} topic=${topic} attempt=${attempt} ` +
            `(${e instanceof Error ? e.message : String(e)}), retry in ${delay}ms`,
        )
      } finally {
        this.consumers.splice(this.consumers.indexOf(consumer), 1)
        await consumer.disconnect().catch(() => undefined)
      }
      await this.sleep(delay)
    }
  }

  /** 等待消费者运行期断开事件（CRASH 或 DISCONNECT），任一触发即 resolve */
  private waitForDisconnect(consumer: Consumer): Promise<void> {
    return new Promise<void>((resolve) => {
      consumer.on(consumer.events.CRASH, () => resolve())
      consumer.on(consumer.events.DISCONNECT, () => resolve())
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** 按前缀拼接 groupId（groupId = ${KAFKA_GROUP_ID_PREFIX}-${topic}） */
  groupId(topic: string): string {
    const prefix = this.config.get<string>('KAFKA_GROUP_ID_PREFIX', 'knowledge-agent')
    return `${prefix}-${topic}`
  }

  /**
   * 健康检查：临时建 admin client 调 listTopics 验证 broker 可达
   * 比 producerReady 布尔更准确（后者冷启动恒 false，且只能反映是否调过 send）
   * @returns true=broker 可达；false=不可达（不抛错，由调用方决定如何上报）
   */
  async healthCheck(): Promise<boolean> {
    const admin = this.kafka.admin()
    try {
      await admin.connect()
      await admin.listTopics()
      return true
    } catch (e) {
      this.logger.warn(`Kafka healthCheck failed: ${e instanceof Error ? e.message : String(e)}`)
      return false
    } finally {
      await admin.disconnect().catch(() => undefined)
    }
  }

  private async ensureProducer(): Promise<void> {
    if (this.producerReady) return
    await this.producer.connect()
    this.producerReady = true
  }

  onModuleDestroy() {
    this.destroying = true
    this.producer.disconnect().catch(() => undefined)
    for (const c of this.consumers) {
      c.disconnect().catch(() => undefined)
    }
  }
}
