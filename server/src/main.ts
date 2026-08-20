/**
 * main.ts —— 启动配置
 * pino logger + Swagger（/api/docs）+ CORS（Vite 开发期 5173）+ API 前缀
 * SSE 路由不包装：ChatController 直接返回 Response 对象透传
 */
import { NestFactory } from '@nestjs/core'
import { Logger as NestLogger } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  })
  // 校验管道已在 AppModule 以 APP_PIPE 注册（ZodValidationPipe），此处不重复注册
  app.useLogger(app.get(Logger))

  // 过滤器 + 拦截器已在 AppModule 注册，此处不重复

  // CORS 开放给前端 Vite 开发期 5173
  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })

  // Swagger UI
  const config = new DocumentBuilder()
    .setTitle('Knowledge Agent API')
    .setDescription('企业智能助手接口文档')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  // API 前缀
  app.setGlobalPrefix('api/v1', {
    // Swagger 路由 + 健康探针不带前缀：
    // 探针是基础设施契约（K8s/docker 用），非业务 API，走无前缀短路径便于探针配置
    exclude: ['api/docs', 'live', 'ready'],
  })

  const port = Number(process.env.APP_PORT) || 3000
  await app.listen(port)

  // 启动横幅走 pino Logger 实例（与项目日志体系统一，不用 console）
  const logger = app.get(Logger)
  logger.log(`knowledge-agent server running on http://localhost:${port}`)
  logger.log(`Swagger UI:        http://localhost:${port}/api/docs`)
}

bootstrap().catch((e) => {
  // bootstrap 失败时 DI 容器不可用，用 Nest 内置 Logger 静态方法兜底
  NestLogger.error(`启动失败: ${e instanceof Error ? e.message : String(e)}`, e instanceof Error ? e.stack : undefined)
  process.exit(1)
})
