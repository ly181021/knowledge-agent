import { describe, it, expect } from 'vitest'
import { groupSessionsByTime } from '../session-group'

interface FakeSession {
  id: string
  updatedAt: string
}

describe('groupSessionsByTime', () => {
  // 把当前时间固定为 2026-07-30T12:00:00（周四）
  const now = new Date('2026-07-30T12:00:00').getTime()

  it('今天内的会话归入"今天"组', () => {
    const sessions: FakeSession[] = [
      { id: '1', updatedAt: '2026-07-30T10:00:00' }, // 同日 2 小时前
      { id: '2', updatedAt: '2026-07-30T08:30:00' }, // 同日 3.5 小时前
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.today.map((s) => s.id)).toEqual(['1', '2'])
    expect(groups.yesterday).toEqual([])
    expect(groups.week).toEqual([])
    expect(groups.earlier).toEqual([])
  })

  it('昨天的会话归入"昨天"组', () => {
    const sessions: FakeSession[] = [
      { id: '3', updatedAt: '2026-07-29T14:30:00' }, // 昨天
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.yesterday.map((s) => s.id)).toEqual(['3'])
    expect(groups.today).toEqual([])
  })

  it('2-7 天前的会话归入"7 天内"组', () => {
    const sessions: FakeSession[] = [
      { id: '4', updatedAt: '2026-07-22T12:00:00' }, // 8 天前 → earlier
      { id: '5', updatedAt: '2026-07-24T12:00:00' }, // 6 天前 → week
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.week.map((s) => s.id)).toEqual(['5'])
    expect(groups.earlier.map((s) => s.id)).toEqual(['4'])
  })

  it('更早的会话归入"更早"组', () => {
    const sessions: FakeSession[] = [
      { id: '6', updatedAt: '2026-06-01T12:00:00' }, // 远早
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.earlier.map((s) => s.id)).toEqual(['6'])
    expect(groups.today).toEqual([])
  })

  it('空数组返回全空分组', () => {
    const groups = groupSessionsByTime<FakeSession>([], now)
    expect(groups.today).toEqual([])
    expect(groups.yesterday).toEqual([])
    expect(groups.week).toEqual([])
    expect(groups.earlier).toEqual([])
  })

  it('invalid updatedAt 字符串归入"更早"不抛错（防御）', () => {
    const sessions: FakeSession[] = [
      { id: '7', updatedAt: 'not-a-date' },
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.earlier.map((s) => s.id)).toEqual(['7'])
  })

  it('跨午夜但不足 24h 的会话算"今天"（按自然日判定，非滚动 24h）', () => {
    // now 是 7-30 12:00；7-30 00:30 仍属今天
    const sessions: FakeSession[] = [
      { id: '8', updatedAt: '2026-07-30T00:30:00' },
    ]
    const groups = groupSessionsByTime(sessions, now)
    expect(groups.today.map((s) => s.id)).toEqual(['8'])
  })
})
