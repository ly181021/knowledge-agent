/**
 * JwtAuthGuard —— common/guards/
 * 全局 Guard，保护所有路由；用 @Public 豁免公开路由（如 login）
 * 只做 token 存在性验证
 * 演示模式（PREVIEW_MODE_ENABLED=true）豁免所有 GET 请求
 *         —— 写请求由 PreviewModeInterceptor 拦，这里只放行读请求
 *         —— 演示模式下管理员也只能看，不能写
 */
import { ExecutionContext, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private config: ConfigService,
  ) {
    super()
  }

  canActivate(context: ExecutionContext) {
    // 读 @Public 标记，有则豁免
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    // 演示模式：放行所有请求（写请求会被 PreviewModeInterceptor 拦）
    // PREVIEW_MODE_ENABLED=true 时所有 GET 无需 token
    if (this.isPreviewEnabled()) return true

    return super.canActivate(context)
  }

  /** env 读到的可能是 'true' / 'false' 字符串或布尔值，统一判定 */
  private isPreviewEnabled(): boolean {
    const raw = this.config.get<string | boolean>('PREVIEW_MODE_ENABLED')
    if (typeof raw === 'boolean') return raw
    return String(raw).toLowerCase() === 'true'
  }
}
