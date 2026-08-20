/**
 * thinking.ts —— 思考过程类型定义
 * 与后端 server/.../progress-emitter.ts 的 PrepareStep 保持同步（手抄，不共享包）
 */

/** 责任链/执行器步骤名 */
export type PrepareStep =
  | 'rewrite'
  | 'subQuestion'
  | 'scopeShrink'
  | 'clarification'
  | 'route'
  | 'retrieval'

/** 单步思考过程（对应后端 progress data part 的 value） */
export interface ThinkingStep {
  step: PrepareStep
  /** 后端发出时间戳，前端做跨请求隔离 */
  ts: number
  /** 各步骤专属数据，宽松类型便于增量演进 */
  payload: Record<string, unknown>
}

/** 一条 assistant 消息的完整思考流（请求结束后冻结） */
export interface ThinkingTrace {
  messageId: string
  steps: ThinkingStep[]
  /** 请求结束（onFinish 或 isLoading false）后置 true，停止累积 */
  frozen: boolean
}

/** StreamData data part 的联合类型（含已有 citations/recommendations + 新 progress） */
export type DataPart =
  | { type: 'progress'; value: ThinkingStep }
  | { type: 'citations'; value: unknown }
  | { type: 'recommendations'; value: unknown }
  | { type: 'tool-status'; value: ToolStatusEvent } // 新增：ReAct 工具过程帧（react-agent.service onStepFinish 推）
  | { type: 'error'; value: string } // 新增：熔断/会话上限错误帧

/** 单次工具调用状态事件（与后端 react-agent.service 的 tool-status 帧对齐） */
export interface ToolStatusEvent {
  toolName: string
  status: 'running' | 'done'
  ts: number
  summary?: string
}
