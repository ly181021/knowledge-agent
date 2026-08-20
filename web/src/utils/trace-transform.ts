/**
 * trace-transform —— TraceStage[] → ThinkingStep[] 转换
 * 供 admin 回溯页复用 StepTimeline 组件渲染
 */
import type { ThinkingStep, PrepareStep } from '@/types/thinking'

/** 后端 TraceStage 的前端投影类型（与 Prisma 返回一致） */
export interface TraceStageLike {
  stage: string
  state: string
  output: unknown
  startedAt: Date | string
  durationMs?: number | null
}

/** 转换：按 startedAt 排序，过滤空 stage，output 作为 payload */
export function traceStagesToThinkingSteps(stages: TraceStageLike[]): ThinkingStep[] {
  return stages
    .filter((s) => s.stage)
    .map((s) => ({
      step: s.stage as PrepareStep,
      ts: new Date(s.startedAt).getTime(),
      payload: (s.output ?? {}) as Record<string, unknown>,
    }))
    .sort((a, b) => a.ts - b.ts)
}
