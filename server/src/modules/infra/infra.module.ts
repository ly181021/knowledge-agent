/**
 * InfraModule —— infra/
 * 聚合 Redis + MinIO + LLM + Kafka provider
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisServiceProvider } from './redis.provider'
import { MinioService } from './minio.provider'
import { LlmService } from './llm.provider'
import { KafkaService } from './kafka.provider'

@Module({
  imports: [ConfigModule],
  providers: [RedisServiceProvider, MinioService, LlmService, KafkaService],
  exports: [RedisServiceProvider, MinioService, LlmService, KafkaService],
})
export class InfraModule {}
