/**
 * ProgressEmitter —— 思考过程实时透传接口
 * 领域层（orchestrator/executor/rag）依赖这个窄接口，不耦合 Vercel AI SDK 的 StreamData。
 * ChatService 在 stream 里创建一个绑定到本次 StreamData 的实例注入进来。
 */

/** 责任链/执行器步骤名 —— 前后端共享（前端 web/src/types/thinking.ts 同步） */
export type PrepareStep =
  | 'rewrite'
  | 'subQuestion'
  | 'scopeShrink'
  | 'clarification'
  | 'route'
  | 'retrieval'

/** 单个 progress 事件（对应 StreamData data part 的 value） */
export interface ProgressEvent {
  step: PrepareStep
  /** 后端发出时的时间戳，前端用来做跨请求隔离 */
  ts: number
  /** 各步骤专属数据，宽松类型便于增量演进 */
  payload: Record<string, unknown>
}

/** 进度发射器接口 */
export interface ProgressEmitter {
  emit(event: ProgressEvent): void
}

/**
 * NoopProgressEmitter —— 默认空实现
 * 当调用方不传 emitter 时（如被别处复用、或单测）使用，保证向后兼容。
 */
export class NoopProgressEmitter implements ProgressEmitter {
  emit(_event: ProgressEvent): void {
    // no-op
  }
}
