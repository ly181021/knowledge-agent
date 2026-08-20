/**
 * formatRelativeTime —— 相对时间格式化
 * 规则（按自然日判定 today/yesterday）：
 *   < 1min        → 刚刚
 *   今天且 < 1h   → X分钟前
 *   今天且 >= 1h  → HH:MM
 *   昨天          → 昨天 HH:MM
 *   2-7 天前      → M月D日
 *   7 天前 - 当年  → M月D日
 *   跨年          → YYYY年M月D日
 *   invalid       → —
 */

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function formatRelativeTime(updatedAt: string, now: number = Date.now()): string {
  const ts = new Date(updatedAt).getTime()
  if (Number.isNaN(ts)) return '—'

  const todayStart = startOfDay(now)
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000

  const d = new Date(ts)
  const nowDate = new Date(now)

  // 今天
  if (ts >= todayStart) {
    const diffMin = Math.floor((now - ts) / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }

  // 昨天
  if (ts >= yesterdayStart) {
    return `昨天 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }

  // 当年 vs 跨年
  if (d.getFullYear() === nowDate.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
