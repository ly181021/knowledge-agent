/**
 * QueryDocumentDto —— 文档列表查询入参
 * GET /admin/documents（分页/搜索/筛选）
 * 用 z.coerce.number 替代 class-transformer 的 @Type( => Number)：
 * query string 自动强转 number，校验失败抛 400
 */
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { DocumentStatus } from '@prisma/client'

export const QueryDocumentSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).default(20),
  keyword: z.string().optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
})

export class QueryDocumentDto extends createZodDto(QueryDocumentSchema) {}
