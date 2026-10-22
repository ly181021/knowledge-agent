/**
 * MinIO Provider —— infra/minio.provider.ts
 * 文档上传落桶用
 */
import { OnModuleInit, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'
import type { Readable } from 'stream'

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger('MinioService')
  private client!: Client
  private bucket!: string

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'knowledge-agent-docs')
    this.client = new Client({
      endPoint: this.config.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: this.config.get<number>('MINIO_PORT', 9000),
      useSSL: this.config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    })
    this.logger.log(`MinIO client ready, bucket=${this.bucket}`)
  }

  getClient(): Client {
    return this.client
  }

  getBucket(): string {
    return this.bucket
  }

  async upload(key: string, body: Buffer | Readable, size?: number): Promise<void> {
    await this.client.putObject(this.bucket, key, body, size)
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }

  async presignedUrl(key: string, expireSeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expireSeconds)
  }
}
