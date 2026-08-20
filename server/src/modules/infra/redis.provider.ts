/**
 * Redis Provider —— infra/redis.provider.ts
 * 只建连接，租约锁用
 * 注意：maxRetriesPerRequest: null 避免队列请求时重试报错（租约锁/reindex 防重入）
 */
import { Provider, OnModuleDestroy, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('RedisService')
  readonly client: Redis

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
    })
    this.client.on('connect', () => this.logger.log('Redis connected'))
    this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`))
  }

  onModuleDestroy() {
    this.client.quit()
  }

  getClient(): Redis {
    return this.client
  }
}

// 导出 RedisService 实例 provider
export const RedisServiceProvider: Provider = {
  provide: RedisService,
  useFactory: (config: ConfigService) => new RedisService(config),
  inject: [ConfigService],
}
