/**
 * UploadDocumentDto —— 上传文档入参（multipart 表单：file 字段 + 以下文本字段同表单提交）
 * 上传元信息
 * 注意：multipart 表单 multer 解析后字段都是字符串，所以这里全部用 z.string。
 * businessType 注释枚举（HR/PRODUCT/OPS/FINANCE/OTHER）但未收紧校验，避免破坏存量数据。
 * tags 是 JSON 字符串（如 [退款,政策]），service 侧 parseTags 容错解析。
 */
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const UploadDocumentSchema = z.object({
  title: z.string().optional(), // 展示名（默认取文件名）
  scopeId: z.string().optional(), // 知识域（一级）
  topicId: z.string().optional(), // 知识专题（二级，需属于 scopeId）
  businessType: z.string().optional(), // 业务分类：HR / PRODUCT / OPS / FINANCE / OTHER
  tags: z.string().optional(), // multipart JSON 字符串，service 侧 parseTags 容错解析
})

export class UploadDocumentDto extends createZodDto(UploadDocumentSchema) {}
