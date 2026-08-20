/**
 * @CurrentUser 装饰器 —— 从 req.user 取当前登录用户
 * common/decorators
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface CurrentUserPayload {
  id: string
  username: string
  role: string
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: CurrentUserPayload }>()
    const user = req.user
    if (!user) return undefined
    return data ? user[data] : user
  },
)
