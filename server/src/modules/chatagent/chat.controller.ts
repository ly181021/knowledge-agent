/**
 * ChatController —— 对话 SSE 入口
 * 需登录；用 @Res passthrough 拿 Express response 直接写流；
 * 不返回值（void），TransformInterceptor 收到 undefined 不包装
 */
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { ChatService } from './chat.service'
import { ChatBodyDto, ChatBody } from './dto/chat.dto'

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'SSE 流式对话（Vercel AI SDK StreamData）' })
  async chat(
    @Body() body: ChatBodyDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.chatService.stream(body as ChatBody, res)
  }

  @Get('sessions')
  @ApiOperation({ summary: '会话列表' })
  sessions() {
    return this.chatService.listSessions()
  }

  @Get('documents')
  @ApiOperation({ summary: '当前文档问答可选文档列表（已索引文档）' })
  documentOptions() {
    return this.chatService.listDocumentOptions()
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: '会话历史消息' })
  messages(@Param('id') id: string) {
    return this.chatService.getMessages(id)
  }
}
