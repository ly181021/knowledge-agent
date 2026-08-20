/**
 * ChatService —— 对话流主体：prepare 编排 → 执行器分发 → SSE 回写 → 收尾单份
 * TraceRecorder 关联写 ChatExchange / ChannelExecution / RetrievalResult / ChatModelUsageTrace
 */
import { Injectable, Inject, Logger } from '@nestjs/common'
import { streamText, StreamData, generateText, type JSONValue, type LanguageModelUsage, type StreamTextResult, type ToolCall } from 'ai'
import type { Response } from 'express'
import { LlmService } from '@/modules/infra/llm.provider'
import { PrismaService } from '@/prisma/prisma.service'
import { ExecutionMode } from '@/common/enums/execution-mode'
import { ChatQueryMode } from '@/common/enums/chat-query-mode'
import { DocumentStatus } from '@prisma/client'
import { PreparationOrchestrator } from './ai/preparation/orchestrator'
import { renderPrompt } from './prompts/render'
import { ExecutorRegistry, type Executor, type ReactStreamDeps } from './ai/executor/registry'
import type { ExecutorContext } from './ai/execution-plan'
import { SESSION_MODEL_LIMIT, SESSION_TOOL_LIMIT } from './ai/react-agent/react-agent.config'
import type { ChatMemory } from './memory/chat-memory'
import { TraceRecorder } from './service/trace/trace-recorder'
import { RecommendationService } from './service/recommendation.service'
import { ChatBody } from './dto/chat.dto'
import type { ProgressEmitter } from './ai/progress-emitter'

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private llm: LlmService,
    private prisma: PrismaService,
    private orchestrator: PreparationOrchestrator,
    private executors: ExecutorRegistry,
    @Inject('CHAT_MEMORY') private memory: ChatMemory,
    private trace: TraceRecorder,
    private recommendation: RecommendationService,
  ) {}

  /** 流式对话主体：编排 → 执行器分发 → SSE 回写，收尾统一走 onFinishCallback */
  async stream(body: ChatBody, res: Response): Promise<void> {
    const { messages, sessionId, chatMode, selectedDocumentId } = body
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    const question = lastUserMsg?.content ?? ''
    const t0 = Date.now()

    this.logger.log(`[stage4] sessionId=${sessionId} chatMode=${chatMode} question=${question.slice(0, 80)}`)

    // 确保 session 存在（前端传的 sessionId 可能还没入 DB）
    await this.ensureSession(sessionId)

    // 0. 先存用户消息（历史持久）
    await this.memory.append(sessionId, { role: 'user', content: question })

    // 按 chatMode 预判执行模式：OPEN_CHAT → REACT_AGENT，其余 RETRIEVAL
    const initialMode = chatMode === ChatQueryMode.OPEN_CHAT ? ExecutionMode.REACT_AGENT : ExecutionMode.RETRIEVAL

    // 3. trace：建 ChatExchange，提前于 prepare 以便 emitter 拿到 exchangeId
    const exchangeId = await this.trace.startExchange(sessionId, question, initialMode)

    // 思考过程实时透传 + TraceStage 持久化：StreamData 提前创建，
    // emitter 把每步 progress 同时写入 data part（SSE 帧）和 TraceStage 表（DB）
    const data = new StreamData()
    const emitter: ProgressEmitter = {
      // 边界 cast：ProgressEvent.payload 是宽松的 Record<string, unknown>（领域层不耦合 SDK），
      // 这里是集成层，把它转成 ai SDK 要求的 JSONValue 后写入 data part
      emit: (e) => {
        // SSE 实时帧
        data.append({ type: 'progress', value: e } as unknown as JSONValue)
        // TraceStage 持久化（fire-and-forget，不 await）
        this.trace.recordStage(sessionId, exchangeId, e)
      },
    }

    // 1. 五步责任链编排（注入 emitter，每步完成即发 progress 帧 + 写 TraceStage）
    const plan = await this.orchestrator.prepare(question, sessionId, emitter, {
      chatMode,
      selectedDocumentId,
    })

    // 2. 执行器分发（注入 emitter，retrieval 完成发 progress 帧 + 写 TraceStage）
    const executor = this.executors.of(plan.mode)
    const ctx = await executor.prepare(plan, emitter)

    // 注意：startExchange 已按 chatMode 预建；若 orchestrator 最终 mode 与预建不同则更新
    if (plan.mode !== initialMode) {
      await this.prisma.chatExchange.update({ where: { id: exchangeId }, data: { executionMode: plan.mode } })
    }

    // 4. trace：记录检索结果（RAG 通道数据 + 每条 chunk 分数）
    if (ctx.ragChannels && ctx.ragResults) {
      await this.trace.recordRetrieval(exchangeId, sessionId, ctx.ragChannels, ctx.ragResults)
    }

    // 5. 引用回传：citations 帧不在正文前发，移到 onFinishCallback 收尾时与 recommendations 按序发出
    // （前端按 回答 → 引用 → 推荐 顺序渲染；提前发会污染上一条气泡，空数组也发以便前端区分无引用与未结束）

    // === 第三层熔断：会话累计预检（ReAct 与单轮共用，进 streamText 前） ===
    const sessionUsage = await this.trace.countSessionUsage(sessionId)
    if (sessionUsage.modelCalls >= SESSION_MODEL_LIMIT || sessionUsage.toolCalls >= SESSION_TOOL_LIMIT) {
      this.logger.warn(
        `[limit] session=${sessionId} modelCalls=${sessionUsage.modelCalls}/${SESSION_MODEL_LIMIT} toolCalls=${sessionUsage.toolCalls}/${SESSION_TOOL_LIMIT}`,
      )
      data.append({ type: 'error', value: '本会话调用已达上限，请新建会话' } as unknown as JSONValue)
      data.close()
      res.end()
      return
    }

    // 收尾逻辑单份，ReAct 自托管流与单轮路径共用：
    // (1) 推荐生成 (2) memory.append (3) recordModelUsage (4) finishExchange
    // (5) 引用回传 (6) 推荐回传 (7) data.close (8) autoTitle
    const onFinishCallback = async (
      text: string,
      usage: LanguageModelUsage,
      toolCalls?: ToolCall<string, unknown>[],
      skipRecommendation = false,
    ): Promise<void> => {
      // (1) 推荐追问生成（提前到 memory.append 之前：引用/推荐随消息一并落库）
      //     熔断兜底路径跳过，不浪费一次 LLM 调用
      let recs: string[] = []
      if (!skipRecommendation) {
        const recT0 = Date.now()
        const { questions, usage: recUsage } = await this.recommendation.generate(plan.rewritten, text)
        recs = questions
        if (recs.length > 0) {
          // trace：记一条 model=recommendation，便于看板区分
          await this.trace.recordModelUsage(
            exchangeId,
            'recommendation',
            {
              promptTokens: recUsage?.promptTokens ?? 0,
              completionTokens: recUsage?.completionTokens ?? 0,
              totalTokens: recUsage?.totalTokens ?? 0,
            },
            Date.now() - recT0,
          )
          this.logger.log(`recommendation: session=${sessionId} count=${recs.length}`)
        }
      }

      // (2) 写记忆（assistant 回复；引用/推荐随消息落库，刷新后历史消息仍能渲染）
      await this.memory.append(
        sessionId,
        { role: 'assistant', content: text },
        {
          tokenCount: usage.completionTokens,
          toolCalls,
          citations: ctx.citations && ctx.citations.length > 0 ? ctx.citations : undefined,
          recommendations: recs.length > 0 ? recs : undefined,
        },
      )

      // (3) trace：写 token 用量
      await this.trace.recordModelUsage(
        exchangeId,
        this.llm.getModelName(),
        {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
        Date.now() - t0,
      )

      // (4) trace：完成 exchange
      await this.trace.finishExchange(exchangeId, text, Date.now() - t0)

      // (5) 引用回传（回答结束后发，先于推荐：前端展示顺序 = 回答 → 引用 → 推荐）
      data.append({ type: 'citations', value: ctx.citations ?? [] })

      // (6) 推荐追问回传
      if (recs.length > 0) {
        data.append({ type: 'recommendations', value: recs })
      }

      this.logger.log(`[stage4] stream done sessionId=${sessionId} tokens=${usage.totalTokens}`)
      // (7) 关闭 data（必须在所有 append 之后；close 非幂等，熔断兜底路径可能二次进入，防御性捕获）
      try {
        data.close()
      } catch {
        // data 已关闭：重复 close 会抛错，忽略即可
      }

      // (8) 会话自动命名：第一条消息时根据问题生成标题
      this.autoTitle(sessionId, question).catch(() => {})
    }

    // === ReAct 分流 ===
    // ReactAgentExecutor 实现 stream，走自托管流（带 tools + maxSteps + 熔断）；
    // 其余执行器无 stream，走单轮 streamText 路径
    const reactExecutor = executor as Executor & {
      stream?: (ctx: ExecutorContext, deps: ReactStreamDeps) => Promise<StreamTextResult<never, never>>
    }
    if (typeof reactExecutor.stream === 'function') {
      try {
        const result = await reactExecutor.stream(ctx, {
          llm: this.llm,
          memory: this.memory,
          trace: this.trace,
          data,
          emitter,
          exchangeId,
          t0,
          onFinish: onFinishCallback,
        })
        await this.pipeToResponse(result, res, data)
      } catch (e) {
        // 熔断兜底：onStepFinish 抛错（工具超限）会中断流且不触发 onFinish，这里补收尾：
        // error 帧 + 记忆/用量/exchange 收尾（跳过推荐生成，不浪费 LLM 调用）
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.warn(`[react-agent] stream interrupted: ${msg}`)
        data.append({ type: 'error', value: msg } as unknown as JSONValue)
        await onFinishCallback('', { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, undefined, true)
      }
    } else {
      // 单轮路径：streamText（无 tools）
      const result = streamText({
        model: this.llm.getChatModel(),
        system: `你是企业智能助手，请基于知识库回答用户问题。${ctx.systemSuffix ?? ''}`,
        messages: [
          ...ctx.history.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
          { role: 'user' as const, content: ctx.userContent },
        ],
        onFinish: async ({ text, usage }) => {
          await onFinishCallback(
            text,
            usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          )
        },
      })
      await this.pipeToResponse(result, res, data)
    }
  }

  /** 把 StreamTextResult 的 SSE 数据流逐块写回 Express response */
  private async pipeToResponse(result: StreamTextResult<never, never>, res: Response, data: StreamData): Promise<void> {
    const aiResponse = result.toDataStreamResponse({ data })
    const reader = aiResponse.body!.getReader()
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value))
    }
    res.end()
  }

  /** 确保 session 存在（前端传的 sessionId 可能还没入 DB） */
  private async ensureSession(sessionId: string): Promise<void> {
    const exists = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!exists) {
      // 用默认 admin 用户创建（不强制绑定 userId）
      const admin = await this.prisma.user.findFirst({ where: { username: 'admin' } })
      await this.prisma.session.create({
        data: {
          id: sessionId,
          userId: admin?.id ?? '',
          title: '新对话',
        },
      })
    }
  }

  /** 会话自动命名：第一条消息时根据问题生成标题 */
  private async autoTitle(sessionId: string, question: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session || session.title !== '新对话') return

    try {
      const prompt = renderPrompt('session-title', { question })
      const { text } = await generateText({
        model: this.llm.getChatModel(),
        system: '你是标题生成助手，只返回标题，不要解释。',
        prompt,
      })
      const title = text.trim().slice(0, 50)
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { title },
      })
      this.logger.log(`autoTitle: session=${sessionId} title="${title}"`)
    } catch (e) {
      this.logger.warn(`autoTitle failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 会话列表 */
  async listSessions() {
    const sessions = await this.prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return sessions
  }

  /** 会话历史消息（供前端切换会话时加载；含引用/推荐，刷新后历史消息可恢复渲染） */
  async getMessages(sessionId: string) {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        citations: true,
        recommendations: true,
        createdAt: true,
      },
    })
    // JSON 列返回字符串，解析成对象供前端直接用
    return messages.map((m) => ({
      ...m,
      citations: m.citations ? JSON.parse(m.citations as unknown as string) : undefined,
      recommendations: m.recommendations ? JSON.parse(m.recommendations as unknown as string) : undefined,
    }))
  }

  /**
   * 当前文档问答模式下的可选文档列表
   * 只返回已索引（INDEXED）的文档，前端用于文档下拉
   */
  async listDocumentOptions() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.INDEXED },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true },
    })
    return docs
  }
}
