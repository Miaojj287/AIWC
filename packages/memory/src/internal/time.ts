/** Local-date helpers (YYYY-MM-DD). Windows use fixed 24h arithmetic (no DST assumptions beyond Date). */
import type { Millis } from '@aiwc/protocol'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function formatDate(ms: Millis | Date): string {
  const d = ms instanceof Date ? ms : new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const ms = new Date(`${date}T00:00:00`).getTime()
  return Number.isFinite(ms) && formatDate(ms) === date
}

/** Local midnight of `date` plus `hour` hours, in ms. */
export function atHour(date: string, hour: number): Millis {
  return new Date(`${date}T00:00:00`).getTime() + hour * 3_600_000
}

export function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + deltaDays)
  return formatDate(d)
}

export function formatClock(ms: Millis): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function clampHour(hour: number): number {
  const h = Math.floor(Number(hour))
  return Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 2
}
