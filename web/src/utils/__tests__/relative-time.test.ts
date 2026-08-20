import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relative-time'

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-30T12:00:00').getTime()

  it('1 分钟内显示"刚刚"', () => {
    expect(formatRelativeTime('2026-07-30T11:59:30', now)).toBe('刚刚')
  })

  it('不足 1 小时显示"X分钟前"', () => {
    expect(formatRelativeTime('2026-07-30T11:58:00', now)).toBe('2分钟前')
  })

  it('今天的更早时段显示"HH:MM"', () => {
    expect(formatRelativeTime('2026-07-30T08:30:00', now)).toBe('08:30')
  })

  it('昨天显示"昨天 HH:MM"', () => {
    expect(formatRelativeTime('2026-07-29T14:30:00', now)).toBe('昨天 14:30')
  })

  it('2-7 天前显示"M月D日"', () => {
    expect(formatRelativeTime('2026-07-24T12:00:00', now)).toBe('7月24日')
  })

  it('7 天前以上显示"M月D日"', () => {
    expect(formatRelativeTime('2026-06-15T10:00:00', now)).toBe('6月15日')
  })

  it('跨年显示"YYYY年M月D日"', () => {
    expect(formatRelativeTime('2025-12-20T10:00:00', now)).toBe('2025年12月20日')
  })

  it('invalid 输入返回"—"', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('—')
    expect(formatRelativeTime('', now)).toBe('—')
  })
})
