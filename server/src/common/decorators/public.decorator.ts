/**
 * @Public 装饰器 —— 标记公开路由，豁免 JwtAuthGuard
 * common/decorators
 */
import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
