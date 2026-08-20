/**
 * HealthModule —— 健康探针模块
 * 提供 GET /live（进程存活）+ GET /ready（依赖就绪）两个 K8s/docker 探针端点
 */
import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { InfraModule } from '@/modules/infra/infra.module'
// PrismaModule 是 @Global，无需在此 import

@Module({
  imports: [InfraModule], // 注入 RedisService / MinioService / KafkaService（InfraModule 非 Global）
  controllers: [HealthController],
})
export class HealthModule {}
