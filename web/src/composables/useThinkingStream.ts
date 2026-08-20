/**
 * useThinkingStream —— 思考过程实时累积
 * 从 useChat 的 data 中提取 progress 帧，按 messageId 累积成 ThinkingTrace
 * - progress 帧先于 assistant 消息建立 → 先挂 pendingMessageId，正文建立后迁移
 * - data 只增不减、跨请求不清空 → processedCount 位置去重，frozen 标记兜底防误累积
 */
import { ref, watch, type Ref } from 'vue'
import type { ThinkingStep, ThinkingTrace, DataPart } from '@/types/thinking'

export interface UseThinkingStreamOptions {
  data: Ref<unknown>
  /** 消息列表 */
  messages: Ref<{ id: string; role: string }[]>
  /** 本次请求的 pending messageId（handleSubmit 时生成，正文建立后迁移到真实 id） */
  pendingMessageId: Ref<string>
}

export function useThinkingStream(options: UseThinkingStreamOptions) {
  const { data, pendingMessageId } = options
  // messageId → ThinkingTrace；ref 包 Map 使 deep watch 能捕获内部变更
  const thinkingMap = ref<Map<string, ThinkingTrace>>(new Map())

  // 已处理的 data part 数量：data 只增不减、跨请求不清空，按位置去重只取新增帧
  let processedCount = 0

  function getOrCreateTrace(messageId: string): ThinkingTrace {
    let trace = thinkingMap.value.get(messageId)
    if (!trace) {
      trace = { messageId, steps: [], frozen: false }
      thinkingMap.value.set(messageId, trace)
    }
    return trace
  }

  watch(
    () => data.value,
    (val) => {
      if (!val) return
      const parts = Array.isArray(val) ? (val as DataPart[]) : [val as DataPart]
      // 防御性兜底：若 data 被替换为更短的数组（理论上不会发生），重置计数避免越界
      if (parts.length < processedCount) processedCount = 0
      const newParts = parts.slice(processedCount)
      processedCount = parts.length
      for (const p of newParts) {
        if (!p || p.type !== 'progress') continue
        const trace = getOrCreateTrace(pendingMessageId.value)
        // 已冻结的 trace 不再累积（跨请求保护）
        if (trace.frozen) continue
        trace.steps.push(p.value as ThinkingStep)
      }
    },
    // flush: 'sync'：同步累积，测试断言需在同一 tick 读取结果
    { deep: true, flush: 'sync' },
  )

  /** 冻结当前 pending trace（请求结束时调用） */
  function freezeCurrent(): void {
    const trace = thinkingMap.value.get(pendingMessageId.value)
    if (trace) trace.frozen = true
  }

  /** 把 pending trace 迁移到真实 messageId（assistant 消息建立后调用） */
  function migrateTrace(fromId: string, toId: string): void {
    const trace = thinkingMap.value.get(fromId)
    if (!trace) return
    thinkingMap.value.delete(fromId)
    thinkingMap.value.set(toId, { ...trace, messageId: toId })
  }

  return { thinkingMap, freezeCurrent, migrateTrace }
}
