/**
 * AppModule —— 根模块
 * ConfigModule + LoggerModule + Prisma + Infra + Auth + Manage + Chatagent
 * 全局注册 JwtAuthGuard，公开路由用 @Public 豁免
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, APP_PIPE } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { validateEnv } from './config/env.schema'
import { ChatagentModule } from './modules/chatagent/chatagent.module'
import { AuthModule } from './modules/auth/auth.module'
import { ManageModule } from './modules/manage/manage.module'
import { InfraModule } from './modules/infra/infra.module'
import { HealthModule } from './modules/health/health.module'
import { PrismaModule } from './prisma/prisma.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { PreviewModeInterceptor } from './modules/auth/interceptors/preview-mode.interceptor'

@Module({
  imports: [
    // 环境变量：validateEnv 启动强校验，必填项缺失或非法直接拒绝启动
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // 定时任务（补偿扫描用 @Interval，6.1.3 的 explorer 会 try/catch 包裹防单次异常崩进程）
    ScheduleModule.forRoot(),

    // pino 结构化日志
    // 开发期 pino-pretty 人类可读，生产 JSON
    // colorize 关闭：pino-pretty 的颜色码（ANSI 转义）与 Windows 中文控制台（GBK 代码页）冲突，
    // 会导致中文乱码 + [39m 之类残留。需要颜色时用 IDE 终端（VS Code 等 UTF-8 友好环境）再开。
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: false, singleLine: true } }
          : undefined,
        // 忽略健康检查与静态资源的日志噪音
        autoLogging: {
          ignore: (req) =>
            !!req.url &&
            (req.url === '/api/docs' ||
              req.url.startsWith('/api/docs/') ||
              // 探针每 10s 一次，不打日志避免噪音
              req.url === '/live' ||
              req.url === '/ready'),
        },
      },
    }),

    // 基座
    PrismaModule,
    InfraModule,

    // 业务模块
    AuthModule,
    ManageModule,
    ChatagentModule,

    // 健康探针（K8s/docker 用，GET /live + /ready）
    HealthModule,
  ],
  controllers: [],
  providers: [
    // 全局校验管道：nestjs-zod 的 ZodValidationPipe
    // 自动从 DTO 类的 __schema__ 元数据取 schema，统一 body/query 校验
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // 全局异常过滤器
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // 全局响应包装拦截器
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // 只读演示模式拦截器（env PREVIEW_MODE_ENABLED=true 时拦截所有写操作）
    { provide: APP_INTERCEPTOR, useClass: PreviewModeInterceptor },
    // 全局 JWT Guard（@Public 豁免）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
