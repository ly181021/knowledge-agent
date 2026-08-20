/**
 * LLM Provider —— OpenAI 兼容模型接入
 * 从 env 读 LLM_BASE_URL / LLM_KEY / LLM_MODEL / EMBEDDING_MODEL 构造 provider，换模型只需改环境变量
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel, EmbeddingModel } from 'ai'

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger('LlmService')
  private chatModel!: LanguageModel
  private embeddingModel!: EmbeddingModel<string>

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const baseURL = this.config.get<string>('LLM_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/')
    const apiKey = this.config.get<string>('LLM_KEY', '')
    const chatModelName = this.config.get<string>('LLM_MODEL', 'qwen-plus')
    const embeddingModelName = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-v4')

    if (!apiKey) {
      this.logger.warn('LLM_KEY 未配置，LLM 调用会失败！请在 server/.env 填入你的 API Key')
    }

    // 部分 OpenAI 兼容模型默认开启思考模式，流式返回 reasoning_content 会导致 @ai-sdk/openai
    // 解析 SSE 时报 Failed to parse stream string 错误。
    // 这里注入 enable_thinking:false 关闭思考模式；若目标服务不识别该参数（如 OpenAI 官方），
    // 设 LLM_DISABLE_THINKING=false 跳过注入。
    const disableThinking = this.config.get<string>('LLM_DISABLE_THINKING', 'true') !== 'false'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customFetch = async (url: any, init?: any) => {
      if (disableThinking && init?.body && typeof init.body === 'string') {
        try {
          const parsed = JSON.parse(init.body)
          parsed.enable_thinking = false
          init.body = JSON.stringify(parsed)
        } catch {
          // 非 JSON body 不处理
        }
      }
      return fetch(url, init)
    }

    const openai = createOpenAI({ baseURL, apiKey, fetch: customFetch })
    this.chatModel = openai.chat(chatModelName)
    this.embeddingModel = openai.embedding(embeddingModelName)

    this.logger.log(`LLM provider ready: baseURL=${baseURL} chat=${chatModelName} embedding=${embeddingModelName}`)
  }

  getModelName(): string {
    return this.config.get<string>('LLM_MODEL', 'qwen-plus')
  }

  getChatModel(): LanguageModel {
    return this.chatModel
  }

  getEmbeddingModel(): EmbeddingModel<string> {
    return this.embeddingModel
  }
}
