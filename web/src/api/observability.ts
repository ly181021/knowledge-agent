/**
 * observability api —— 可观测接口
 */
import { http } from './request'

export interface MetricsData {
  tokenTrend: { date: string; tokens: number; qps: number }[]
  topHitDocuments: { docId: string; docTitle: string; count: number }[]
  modeDistribution: { mode: string; count: number }[]
}

/** 会话列表项（listSessions 返回 items 的元素） */
export interface SessionListItem {
  id: string
  title: string | null
  status: string
  createdAt: string
  updatedAt: string
  exchangeCount: number
  lastMode: string | null
  lastDurationMs: number | null
}

/** listSessions 返回结构（含分页元信息） */
export interface SessionListRes {
  page: number
  size: number
  total: number
  items: SessionListItem[]
}

/** 命中指定文档的会话项（documentSessions 钻取返回） */
export interface DocumentSessionItem {
  id: string
  title: string
  updatedAt: string
  hitCount: number
}

/** 会话列表筛选参数（对应后端 listSessions 入参） */
export interface SessionListParams {
  page?: number
  size?: number
  keyword?: string
  mode?: string
  dateFrom?: string
  dateTo?: string
}

export const observabilityApi = {
  getMetrics(range: '7d' | '30d' | 'all' | string = '7d') {
    return http.get<MetricsData>('/admin/observability/metrics', { params: { range } })
  },
  listSessions(params: SessionListParams = {}) {
    return http.get<SessionListRes>('/admin/observability/sessions', { params })
  },
  documentSessions(docId: string) {
    return http.get<DocumentSessionItem[]>(`/admin/observability/documents/${docId}/sessions`)
  },
  sessionDetail(id: string) {
    return http.get(`/admin/observability/sessions/${id}`)
  },
  sessionTrace(id: string) {
    return http.get(`/admin/observability/sessions/${id}/trace`)
  },
  sessionRetrieval(id: string) {
    return http.get(`/admin/observability/sessions/${id}/retrieval`)
  },
}
