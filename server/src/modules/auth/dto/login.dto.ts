/**
 * LoginDto —— 登录入参
 * POST /auth/login
 * 用 nestjs-zod 的 createZodDto 包装 zod schema：
 * - schema 即类型（z.infer 推导），校验与类型一份代码
 * - Swagger 自动从 schema 生成 OpenAPI 字段（无需 @ApiProperty）
 */
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const LoginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(6, '密码至少 6 位'),
})

export class LoginDto extends createZodDto(LoginSchema) {}
