/**
 * PreviewModeInterceptor —— 只读演示模式
 * 定位：全局写操作开关
 * - env PREVIEW_MODE_ENABLED=true 时启用
 * - 启用后所有 POST/PUT/DELETE/PATCH 请求直接抛 400
 * - GET 请求放行（看历史会话、文档列表、trace 都 OK）
 * 关键权衡：演示模式下管理员也只能看，不能写（有意为之的产品语义）。
 * 关闭模式只需改 env，无需改代码。
 */
import { Injectable, BadRequestException, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Observable } from 'rxjs'

const WRITE_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH']

@Injectable()
export class PreviewModeInterceptor implements NestInterceptor {
  constructor(private config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.isPreviewEnabled()
    if (!enabled) return next.handle()

    const req = context.switchToHttp().getRequest()
    if (WRITE_METHODS.includes(req.method)) {
      const message =
        this.config.get<string>('PREVIEW_MODE_MESSAGE') ?? '预览模式下不可执行写操作'
      throw new BadRequestException(message)
    }
    return next.handle()
  }

  /** env 读到的可能是 'true' / 'false' 字符串或布尔值，统一判定 */
  private isPreviewEnabled(): boolean {
    const raw = this.config.get<string | boolean>('PREVIEW_MODE_ENABLED')
    if (typeof raw === 'boolean') return raw
    return String(raw).toLowerCase() === 'true'
  }
}
