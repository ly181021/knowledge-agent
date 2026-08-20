/**
 * groupSessionsByTime —— 按自然日把会话分到 4 个桶
 * today / yesterday / week(2-7天前) / earlier(7天前以前)
 * 判定基于自然日（0点切换），非滚动 24 小时窗口
 */

export interface TimeBuckets<T> {
  today: T[]
  yesterday: T[]
  week: T[]
  earlier: T[]
}

/** 归一化为当天 00:00 的时间戳 */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupSessionsByTime<T extends { updatedAt: string }>(
  sessions: T[],
  now: number = Date.now(),
): TimeBuckets<T> {
  const todayStart = startOfDay(now)
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000

  const result: TimeBuckets<T> = { today: [], yesterday: [], week: [], earlier: [] }

  for (const s of sessions) {
    const ts = new Date(s.updatedAt).getTime()
    // invalid date → NaN，归入 earlier（防御，不抛错）
    if (Number.isNaN(ts) || ts < weekStart) {
      result.earlier.push(s)
    } else if (ts >= todayStart) {
      result.today.push(s)
    } else if (ts >= yesterdayStart) {
      result.yesterday.push(s)
    } else {
      result.week.push(s)
    }
  }
  return result
}
