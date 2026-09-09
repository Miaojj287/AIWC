/** Time helpers shared by mirror / facade / demo. All public timestamps are millisecond epochs. */
export const SECOND = 1_000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const nowMs = (): number => Date.now()

/** WeChat stores seconds; the protocol uses milliseconds. Values below 1e11 are treated as seconds. */
export function toMillis(value: number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n)
}

export function toSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

/** Local-time YYYY-MM-DD. */
export function formatDate(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
