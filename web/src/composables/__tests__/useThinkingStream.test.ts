import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useThinkingStream } from '../useThinkingStream'

describe('useThinkingStream', () => {
  it('收到 progress 帧时累积到 pending messageId', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'progress', value: { step: 'rewrite', ts: 1000, payload: { from: 'a', to: 'b' } } }]
    const trace = thinkingMap.value.get('pending-1')
    expect(trace?.steps).toHaveLength(1)
    expect(trace?.steps[0]?.step).toBe('rewrite')
  })

  it('多条 progress 帧累积到同一 trace', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'progress', value: { step: 'rewrite', ts: 1000, payload: {} } }]
    data.value = [...(data.value as []), { type: 'progress', value: { step: 'route', ts: 1001, payload: {} } }]
    expect(thinkingMap.value.get('pending-1')?.steps).toHaveLength(2)
  })

  it('freezeCurrent 把 pending trace 置 frozen', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap, freezeCurrent } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'progress', value: { step: 'rewrite', ts: 1000, payload: {} } }]
    freezeCurrent()
    expect(thinkingMap.value.get('pending-1')?.frozen).toBe(true)
  })

  it('迁移 pending trace 到真实 messageId', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap, migrateTrace } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'progress', value: { step: 'rewrite', ts: 1000, payload: {} } }]
    migrateTrace('pending-1', 'real-msg-1')
    expect(thinkingMap.value.get('pending-1')).toBeUndefined()
    expect(thinkingMap.value.get('real-msg-1')?.steps).toHaveLength(1)
  })

  it('忽略非 progress 帧', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'citations', value: [] }]
    expect(thinkingMap.value.get('pending-1')).toBeUndefined()
  })

  it('冻结后的 trace 不再累积新帧', () => {
    const data = ref<unknown>(null)
    const messages = ref<{ id: string; role: string }[]>([])
    const pendingId = ref('pending-1')
    const { thinkingMap, freezeCurrent } = useThinkingStream({ data, messages, pendingMessageId: pendingId })

    data.value = [{ type: 'progress', value: { step: 'rewrite', ts: 1000, payload: {} } }]
    freezeCurrent()
    data.value = [...(data.value as []), { type: 'progress', value: { step: 'route', ts: 1001, payload: {} } }]
    // 第二帧被 frozen 拒绝，steps 仍只有 1 条
    expect(thinkingMap.value.get('pending-1')?.steps).toHaveLength(1)
  })
})
