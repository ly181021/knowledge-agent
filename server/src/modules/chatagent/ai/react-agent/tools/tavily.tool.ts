/**
 * tavily.tool.ts —— 联网搜索工具（ReAct 工具 2/2）
 * 手写 fetch 调 Tavily API（不装包），TAVILY_KEY 未配置时返回错误对象让模型感知。
 */
import { z } from 'zod'
import type { ConfigService } from '@nestjs/config'

/** Tavily /search 响应里的单条结果（只取标题 + 正文片段） */
interface TavilySearchResult {
  title?: string
  content?: string
}

export function createTavilyTools(config: ConfigService) {
  return {
    webSearch: {
      description: '联网搜索最新信息。当问题涉及实时数据、新闻、最新动态、知识库外的客观事实、时效性内容时使用。',
      parameters: z.object({ query: z.string().describe('搜索关键词') }),
      execute: async ({ query }: { query: string }) => {
        const key = config.get<string>('TAVILY_KEY')
        if (!key) return { error: '联网搜索未配置（TAVILY_KEY 未设置）' }
        const baseUrl = config.get<string>('TAVILY_BASE_URL', 'https://api.tavily.com')
        const res = await fetch(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ query, max_results: 3 }),
        })
        if (!res.ok) return { error: `搜索失败: ${res.status}` }
        const data = (await res.json()) as { results?: TavilySearchResult[] }
        return {
          results: (data.results ?? []).map((r) => ({
            title: r.title,
            content: r.content?.slice(0, 300),
          })),
        }
      },
    },
  }
}
