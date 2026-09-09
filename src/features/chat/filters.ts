/**
 * Per-tab filter state for the chat preview (DESIGN-SPEC §1.2 同步条): a date range (preset or custom)
 * and a sender multi-select. Pure helpers — the state itself lives in `tab.state.filters`.
 */
import type { ListMessagesQuery } from '@aiwc/protocol'

export type DateRangePreset = 'today' | '7d' | '30d' | 'all'

export type DateRange = { preset: DateRangePreset } | { preset: 'custom'; from: number; to: number }

export interface ChatFilters {
  range: DateRange
  /** Empty = everyone. */
  senderIds: string[]
}

export const DEFAULT_FILTERS: ChatFilters = { range: { preset: 'all' }, senderIds: [] }

export const RANGE_PRESETS: ReadonlyArray<{ value: DateRangePreset; label: string; description: string }> = [
  { value: 'today', label: '今天', description: '只看今天 0 点以后的消息' },
  { value: '7d', label: '最近 7 天', description: '含今天在内的 7 个自然日' },
  { value: '30d', label: '最近 30 天', description: '含今天在内的 30 个自然日' },
  { value: 'all', label: '全部', description: '不限制时间' },
]

const DAY = 86_400_000

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ms: number): number {
  return startOfDay(ms) + DAY - 1
}

/** Absolute [from, to] bounds (inclusive, ms) for the substrate query. */
export function resolveRange(range: DateRange, now: number = Date.now()): { from?: number; to?: number } {
  switch (range.preset) {
    case 'today':
      return { from: startOfDay(now) }
    case '7d':
      return { from: startOfDay(now) - 6 * DAY }
    case '30d':
      return { from: startOfDay(now) - 29 * DAY }
    case 'custom': {
      const from = startOfDay(Math.min(range.from, range.to))
      const to = endOfDay(Math.max(range.from, range.to))
      return { from, to }
    }
    default:
      return {}
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD in local time (for <input type="date"> and labels). */
export function toDateInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Parse YYYY-MM-DD (local midnight). Returns undefined for anything else. */
export function parseDateInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined
  return date.getTime()
}

export function validateCustomRange(fromInput: string, toInput: string, now: number = Date.now()): { ok: true; from: number; to: number } | { ok: false; error: string } {
  const from = parseDateInput(fromInput)
  const to = parseDateInput(toInput)
  if (from === undefined || to === undefined) return { ok: false, error: '日期格式应为 YYYY-MM-DD' }
  if (from > to) return { ok: false, error: '开始日期不能晚于结束日期' }
  if (from > endOfDay(now)) return { ok: false, error: '开始日期不能晚于今天' }
  return { ok: true, from, to }
}

/** Sync-bar label: 今天 / 最近 7 天 / … / 2026-04-22 至 今天. */
export function rangeLabel(range: DateRange, now: number = Date.now()): string {
  if (range.preset === 'custom') {
    const to = startOfDay(range.to) === startOfDay(now) ? '今天' : toDateInput(range.to)
    return `${toDateInput(range.from)} 至 ${to}`
  }
  return RANGE_PRESETS.find((p) => p.value === range.preset)?.label ?? '全部'
}

export function isFiltered(filters: ChatFilters): boolean {
  return filters.range.preset !== 'all' || filters.senderIds.length > 0
}

/** Validate whatever was persisted in tab.state; anything malformed falls back to the default. */
export function parseFilters(raw: unknown): ChatFilters {
  if (!raw || typeof raw !== 'object') return DEFAULT_FILTERS
  const obj = raw as { range?: unknown; senderIds?: unknown }
  let range: DateRange = DEFAULT_FILTERS.range
  if (obj.range && typeof obj.range === 'object') {
    const r = obj.range as { preset?: unknown; from?: unknown; to?: unknown }
    if (r.preset === 'custom' && typeof r.from === 'number' && typeof r.to === 'number' && Number.isFinite(r.from) && Number.isFinite(r.to)) {
      range = { preset: 'custom', from: r.from, to: r.to }
    } else if (r.preset === 'today' || r.preset === '7d' || r.preset === '30d' || r.preset === 'all') {
      range = { preset: r.preset }
    }
  }
  const senderIds = Array.isArray(obj.senderIds) ? obj.senderIds.filter((s): s is string => typeof s === 'string' && s.length > 0) : []
  return { range, senderIds: [...new Set(senderIds)] }
}

/** Base query for listMessages with the tab filters applied (paging keys added by the caller). */
export function toListQuery(sessionId: string, filters: ChatFilters, limit: number, now: number = Date.now()): ListMessagesQuery {
  const { from, to } = resolveRange(filters.range, now)
  const q: ListMessagesQuery = { sessionId, limit }
  if (from !== undefined) q.from = from
  if (to !== undefined) q.to = to
  if (filters.senderIds.length > 0) q.senderIds = [...filters.senderIds]
  return q
}

export type ExportRangeMode = 'filtered' | 'selected' | 'all'

export interface ExportRange {
  from?: number
  to?: number
  messageIds?: string[]
}

/**
 * Export range (DESIGN-SPEC §1.2 底部操作条): default = current filters; when messages are ticked the
 * ticked set wins; `all` ignores filters. Sender filters cannot be expressed in the export contract,
 * so they are applied by narrowing to explicit message ids when the caller passes the loaded list.
 */
export function computeExportRange(
  mode: ExportRangeMode,
  filters: ChatFilters,
  selectedIds: ReadonlySet<string> | readonly string[],
  now: number = Date.now(),
): ExportRange {
  if (mode === 'selected') {
    const ids = [...new Set(selectedIds instanceof Set ? [...selectedIds] : [...selectedIds])]
    return { messageIds: ids }
  }
  if (mode === 'all') return {}
  const { from, to } = resolveRange(filters.range, now)
  const out: ExportRange = {}
  if (from !== undefined) out.from = from
  if (to !== undefined) out.to = to
  return out
}

/** Which export mode the dialog should default to. */
export function defaultExportMode(selectedCount: number, filters: ChatFilters): ExportRangeMode {
  if (selectedCount > 0) return 'selected'
  return isFiltered(filters) ? 'filtered' : 'all'
}
