/**
 * document api —— 文档管理接口
 */
import { http } from './request'
import type { PageRes, ParseStage } from '@/types'

export interface DocItem {
  id: string
  title: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  status: 'PARSING' | 'INDEXING' | 'INDEXED' | 'FAILED' | 'SOFT_DELETED'
  /** 解析阶段（细粒度状态，PARSING 期间展示解析进度） */
  parseStage?: ParseStage | null
  /** 失败原因分类（KAFKA_SEND_FAILED / LOW_QUALITY / PIPELINE_ERROR / PARSE_TIMEOUT / MAX_RETRY_EXCEEDED） */
  errorCode?: string | null
  /** 失败详情（FAILED 时展示给用户） */
  errorMsg?: string | null
  charCount: number | null
  tokenCount: number | null
  quality?: string | null
  businessType?: string | null
  tags?: string[] | null
  scopeId?: string | null
  topicId?: string | null
  createdAt: string
  updatedAt: string
  /** 索引块数（后端 list 聚合，可选） */
  chunkCount?: number | null
  /** 切块策略：结构/递归（后端推断，可选） */
  headingStrategy?: string | null
}

/** 概览聚合：Document 字段 + chunkCount + totalDurationMs */
export interface DocOverview extends DocItem {
  chunkCount: number
  totalDurationMs: number
}

/** 任务日志条目（任务时间线 + 进度轮询） */
export interface TaskLogItem {
  id: string
  documentId: string
  stage: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  message?: string | null
  durationMs?: number | null
  percent?: number | null
  createdAt: string
}

/** 切块策略枚举 */
export type ChunkStrategy = 'STRUCTURE' | 'RECURSIVE' | 'SEMANTIC' | 'LLM'

/** 推荐配置（系统推荐只读展示）：IndexConfig + 推荐理由 */
export interface RecommendConfig {
  chunkSize: number
  overlap: number
  pipeline: ChunkStrategy[]
  semanticThreshold: number
  reason: string
}

/** DB 已存配置（表单回填 + 判断 RECOMMEND/MANUAL） */
export interface SavedConfig {
  documentId: string
  chunkSize: number
  overlap: number
  pipeline: ChunkStrategy[] | null
  semanticThreshold: number | null
  parseMode?: string | null
  source: 'RECOMMEND' | 'MANUAL'
}

/** Chunk 预览条目 */
export interface ChunkItem {
  id: string
  chunkIndex: number
  content: string
  preview: string
  charCount: number
  headingPath: string[]
  parentBlockId: string | null
}

export const documentApi = {
  list(params: { page: number; size: number; keyword?: string; status?: string }) {
    return http.get<PageRes<DocItem>>('/admin/documents', { params })
  },
  detail(id: string) {
    return http.get<DocItem>(`/admin/documents/${id}`)
  },
  upload(file: File) {
    const form = new FormData()
    form.append('file', file)
    return http.post<DocItem>('/admin/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  remove(id: string) {
    return http.delete(`/admin/documents/${id}`)
  },
  /** 文档概览聚合 */
  overview(id: string) {
    return http.get<DocOverview>(`/admin/documents/${id}/overview`)
  },
  /** 任务记录时间线 + 进度轮询 */
  taskLogs(id: string) {
    return http.get<TaskLogItem[]>(`/admin/documents/${id}/task-logs`)
  },
  /** 重新索引（可选携带手动配置） */
  reindex(id: string, config?: Record<string, unknown>) {
    return http.post<DocItem>(`/admin/documents/${id}/reindex`, config ? { config } : undefined)
  },
  /** 系统推荐配置 + 推荐理由 */
  configRecommend(id: string) {
    return http.get<RecommendConfig>(`/admin/documents/${id}/config/recommend`)
  },
  /** 当前已存配置（null=从未手动覆盖，用推荐值） */
  config(id: string) {
    return http.get<SavedConfig | null>(`/admin/documents/${id}/config`)
  },
  /** 保存手动覆盖配置（表单提交，source→MANUAL） */
  saveConfig(id: string, body: Partial<SavedConfig>) {
    return http.put<SavedConfig>(`/admin/documents/${id}/config`, body)
  },
  /** Chunk 预览（内容/章节路径/父块） */
  chunks(id: string) {
    return http.get<ChunkItem[]>(`/admin/documents/${id}/chunks`)
  },
}
