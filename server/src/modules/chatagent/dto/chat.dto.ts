/**
 * ChatBody DTO —— Zod schema
 * chatMode / selectedDocumentId 为新增字段（三种问答模式）：
 * - chatMode 默认 AUTO_DOCUMENT（保持向后兼容）
 * - DOCUMENT 模式下 selectedDocumentId 必填（见 .refine 校验）
 * ChatBodyDto 用 nestjs-zod 的 createZodDto 包装，Swagger 自动生成字段；
 * ChatBody 类型别名保留，供 chat.service 等业务逻辑引用。
 */
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'

export const ChatBodySchema = z
  .object({
    id: z.string().optional(), // 客户端消息 id，可选（前端 SDK 不同版本是否注入 id 行为不一致，后端逻辑不依赖此字段）
    sessionId: z.string(), // 会话 id
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system']),
          content: z.string(),
        }),
      )
      .min(1, 'messages 至少 1 条'),
    // 三种问答模式，默认 AUTO_DOCUMENT（全库 RAG，等价于改动前的行为）
    chatMode: z.nativeEnum(ChatQueryMode).default(ChatQueryMode.AUTO_DOCUMENT),
    // 当前文档问答模式下用户选中的文档 id
    selectedDocumentId: z.string().optional(),
  })
  .refine(
    (body) => body.chatMode !== ChatQueryMode.DOCUMENT || !!body.selectedDocumentId,
    { message: '当前文档问答模式下必须指定 selectedDocumentId' },
  )

/** Controller 入参类型（createZodDto 派生类，含 Swagger 元数据） */
export class ChatBodyDto extends createZodDto(ChatBodySchema) {}

/** 业务逻辑用的类型（从 schema 推导，与 DTO 同构） */
export type ChatBody = z.infer<typeof ChatBodySchema>
