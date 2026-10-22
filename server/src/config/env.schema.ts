/**
 * env.schema —— config/
 * 环境变量启动强校验：不合规直接拒绝启动，避免带病运行
 * 新增必填项时在 schema 加一行即可，规则集中在这一处，读取点不再各自兜底
 */
import { z } from 'zod'

export const envSchema = z.object({
  // 密钥类必填且无默认
  // 用 superRefine 而非 min 加 refine：占位符要先于长度报，只报长度会误导人去补字符
  JWT_SECRET: z.string().superRefine((v, ctx) => {
    // 占位符特征两类：示例文件的双花括号开头；曾随仓库公开的历史默认密钥含 change-me 片段
    // 历史值按片段拦而不比对全文，避免旧串回流代码库
    if (v.includes('{{') || v.toLowerCase().includes('change-me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '不能使用示例文件占位符，请生成真实密钥',
      })
      return
    }
    if (v.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '至少 32 字符，建议用 node 的 crypto.randomBytes(48) 转 base64 生成',
      })
    }
  }),

  // 基础设施凭据同样必填：漏配在启动时报错，读取点不再各自兜底默认值
  PG_URL: z
    .string()
    .startsWith('postgresql://', 'pgvector 连接串必填且以 postgresql:// 开头，参考 .env.example'),
  MINIO_ACCESS_KEY: z.string().min(1, 'MinIO accessKey 必填，本地开发与 compose 默认同为 minioadmin'),
  MINIO_SECRET_KEY: z.string().min(1, 'MinIO secretKey 必填，本地开发与 compose 默认同为 minioadmin'),

  // 非敏感项允许默认值兜底
  JWT_EXPIRES_IN: z.string().default('720m'),
})

/**
 * ConfigModule 的 validate 入口
 * 返回值会替换配置内部存储，未登记进 schema 的变量原样透传，防止其他配置项丢失
 */
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    // 逐字段拼出可读信息，启动日志直接指明缺什么、为什么不合格
    throw new Error(
      '环境变量校验失败：\n' +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    )
  }
  return { ...raw, ...parsed.data }
}
