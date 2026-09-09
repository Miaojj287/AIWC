/**
 * Display formatting shared by every feature. Pure functions; `now` is injectable for tests.
 *
 *  formatTime        list / meta column:   今天 → HH:mm · 昨天 → 昨天 · 今年 → M/D · 更早 → YYYY/M/D
 *  formatDateDivider chat divider pill:    今天 / 昨天 / M月D日 / YYYY年M月D日
 *  formatClock       HH:mm
 *  formatRelative    刚刚 / N分钟前 / N小时前, then falls back to formatTime
 *  formatDuration    m:ss (h:mm:ss above an hour)         formatVoiceDuration  12"
 *  formatBytes       1.2 KB / 3.4 MB                      formatCount          99+
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const pad2 = (n: number) => String(n).padStart(2, '0')

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whole-day difference between two timestamps in local time (positive = `ms` is earlier). */
export function dayDiff(ms: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
}

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatTime(ms: number | undefined, now: number = Date.now()): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return ''
  const days = dayDiff(ms, now)
  if (days <= 0) return formatClock(ms)
  if (days === 1) return '昨天'
  const d = new Date(ms)
  const n = new Date(now)
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function formatDateDivider(ms: number, now: number = Date.now()): string {
  const days = dayDiff(ms, now)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  const d = new Date(ms)
  const n = new Date(now)
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** Full timestamp for tooltips / records: YYYY/M/D HH:mm */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${formatClock(ms)}`
}

export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < 24 * HOUR && dayDiff(ms, now) === 0) return `${Math.floor(diff / HOUR)} 小时前`
  return formatTime(ms, now)
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

/** WeChat-style voice length: 12" (minimum 1"). */
export function formatVoiceDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}"`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const text = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[i]}`
}

/** Badge count with a cap: 99+ */
export function formatCount(n: number, max = 99): string {
  if (n <= 0) return ''
  return n > max ? `${max}+` : String(n)
}

/** Thousands separator for stats: 1,284 */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Ratio (0–1) → 62% */
export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return ''
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Middle-ellipsis for paths / wxids that must stay recognisable at both ends. */
export function truncateMiddle(text: string, max = 32): string {
  if (text.length <= max) return text
  const keep = Math.max(2, Math.floor((max - 1) / 2))
  return `${text.slice(0, keep)}…${text.slice(text.length - (max - 1 - keep))}`
}
