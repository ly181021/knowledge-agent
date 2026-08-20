/**
 * useToolStatusStream —— ReAct 工具调用过程实时累积
 * 从 useChat 的 data ref 中提取 type:'tool-status' 帧，按 messageId 累积成 ToolStatusEvent[]。
 * 照抄 useThinkingStream 的三件套（缺一不可）：
 * 1. processedCount 位置去重：useChat 的 data 只增不减、跨请求不清空，只处理 slice(processedCount) 的新增部分
 * 2. pendingMessageId 累积：tool-status 帧在 assistant 消息建立前发出，先挂 pending，正文建立后 migrate 到真实 id
 * 3. deep: true, flush: 'sync'：同 tick 多帧不丢，测试断言同 tick 可读
 * 与 thinking 的差异：工具事件只在请求期间产生（pending 清空后无新帧），
 * 列表不需要 frozen 标记，freezeCurrent 保留为无操作以对齐接口。
 */
import { ref, watch, type Ref } from 'vue'
import type { DataPart, ToolStatusEvent } from '@/types/thinking'

export interface UseToolStatusStreamOptions {
  data: Ref<unknown>
  /** 消息列表（与 useThinkingStream 对齐，保留给未来按 last-assistant-id 查找的场景） */
  messages: Ref<{ id: string; role: string }[]>
  /** 本次请求的 pending messageId（handleSubmit 时生成，正文建立后迁移到真实 id） */
  pendingMessageId: Ref<string>
}

export function useToolStatusStream(options: UseToolStatusStreamOptions) {
  const { data, pendingMessageId } = options
  // Map<messageId, ToolStatusEvent[]> —— 用 ref 包 Map，deep watch 触发响应式
  const toolStatusMap = ref<Map<string, ToolStatusEvent[]>>(new Map())

  // 已处理的 data part 数量（按位置去重，见文件头注释）
  let processedCount = 0

  function getOrCreateList(messageId: string): ToolStatusEvent[] {
    let list = toolStatusMap.value.get(messageId)
    if (!list) {
      list = []
      toolStatusMap.value.set(messageId, list)
    }
    return list
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
        if (!p || p.type !== 'tool-status') continue
        getOrCreateList(pendingMessageId.value).push(p.value)
      }
    },
    // flush:'sync' 让 watch 在 data.value 变更后同步触发，使测试断言能在同一 tick 内读取到累积结果
    { deep: true, flush: 'sync' },
  )

  /** 冻结当前 pending 列表（对齐 useThinkingStream 接口；工具帧仅在请求期间产生，实际无操作） */
  function freezeCurrent(): void {
    // no-op：pending 清空后自然停止累积，无需 frozen 标记
  }

  /** 把 pending 列表迁移到真实 messageId（assistant 消息建立后调用） */
  function migrateTrace(fromId: string, toId: string): void {
    const list = toolStatusMap.value.get(fromId)
    if (!list) return
    toolStatusMap.value.delete(fromId)
    toolStatusMap.value.set(toId, list)
  }

  return { toolStatusMap, freezeCurrent, migrateTrace }
}
