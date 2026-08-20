/**
 * 轻量任务状态机常量与映射
 * parseStage 是展示给用户的解析到哪一步细粒度阶段（业务语义 5 值），
 * 与 status（PARSING/INDEXED/FAILED 粗粒度）互补。
 * 映射规则（taskLog 的 6 个 STAGE → parseStage 5 值）：
 *   初始           → UPLOADED（已上传待处理）
 *   PARSE          → PARSING（解析文本）
 *   CHUNK          → CHUNKING（切块）
 *   VECTORIZE      → VECTORIZING（向量化，含后续 PARENT_BLOCK + KEYWORD_INDEX 都是索引构建）
 *   PARENT_BLOCK   → VECTORIZING
 *   KEYWORD_INDEX  → VECTORIZING
 *   收尾           → INDEXED（终态）
 */
import { STAGE } from './task-log.service'

/** parseStage 业务语义枚举（前端展示用） */
export const PARSE_STAGE = {
  UPLOADED: 'UPLOADED',
  PARSING: 'PARSING',
  CHUNKING: 'CHUNKING',
  VECTORIZING: 'VECTORIZING',
  INDEXED: 'INDEXED',
} as const

/** taskLog STAGE → parseStage 映射（PARENT_BLOCK / KEYWORD_INDEX 归 VECTORIZING） */
export const STAGE_TO_PARSE_STAGE: Record<string, string> = {
  [STAGE.PARSE]: PARSE_STAGE.PARSING,
  [STAGE.CHUNK]: PARSE_STAGE.CHUNKING,
  [STAGE.STRUCTURE_NODE]: PARSE_STAGE.CHUNKING,
  [STAGE.VECTORIZE]: PARSE_STAGE.VECTORIZING,
  [STAGE.PARENT_BLOCK]: PARSE_STAGE.VECTORIZING,
  [STAGE.KEYWORD_INDEX]: PARSE_STAGE.VECTORIZING,
  // PROFILE 不映射（STAGE_TO_PARSE_STAGE 无此项 → setStage 只更新 currentStage 不动 parseStage，
  // 保持 VECTORIZING 直到 INDEXED——PROFILE 是收尾副产物）
}

/** errorCode 枚举（失败原因分类，前端可按 code 做差异化展示） */
export const ERROR_CODE = {
  KAFKA_SEND_FAILED: 'KAFKA_SEND_FAILED',
  LOW_QUALITY: 'LOW_QUALITY',
  PIPELINE_ERROR: 'PIPELINE_ERROR',
  PARSE_TIMEOUT: 'PARSE_TIMEOUT',
  MAX_RETRY_EXCEEDED: 'MAX_RETRY_EXCEEDED',
} as const

/** ：应用层重投上限（超限标 FAILED 停投，避免坏消息无限重投挤占队列） */
export const MAX_RETRY = 3

/** 截断 errorMsg 防超长（字段虽是 Text，双保险防异常长堆栈信息） */
export function truncateMsg(msg: string, max = 500): string {
  return msg.length > max ? msg.slice(0, max) : msg
}
