/**
 * The one table shape the agent produces. Each platform adapter maps it onto its own field types and
 * cell formats; everything that can be decided without the vendor (limits, types, coercion, select
 * options, dates) is decided here, once, so the adapters stay thin and behave the same.
 */
import type { OfficeCellValue, OfficeColumnType, OfficeTableColumn } from '@aiwc/protocol'

export const MAX_COLUMNS = 50
export const MAX_ROWS = 5000
export const MAX_CELL_CHARS = 10_000
export const MAX_SELECT_OPTIONS = 200

export interface TableInput {
  title: string
  sheetName?: string
  columns: Array<{ name: string; type?: OfficeColumnType }>
  rows: Array<Record<string, OfficeCellValue | undefined>>
}

/** A parsed calendar value, kept in wall-clock parts so every platform formats it the same way. */
export interface DateParts {
  y: number
  m: number
  d: number
  hh: number
  mm: number
  ss: number
  hasTime: boolean
}

export type Cell =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'date'; value: DateParts }
  | { type: 'select'; value: string }
  | { type: 'multi_select'; value: string[] }
  | { type: 'checkbox'; value: boolean }
  | { type: 'url'; value: string }

export interface NormalizedColumn extends OfficeTableColumn {
  /** Distinct values seen in select / multi_select columns, in first-seen order. */
  options: string[]
}

export interface NormalizedTable {
  title: string
  sheetName: string
  columns: NormalizedColumn[]
  /** Only non-empty cells; keys are column names. */
  rows: Array<Record<string, Cell>>
  warnings: string[]
}

export class TableValidationError extends Error {}

export function normalizeTable(input: TableInput): NormalizedTable {
  const warnings: string[] = []
  const title = clean(input.title, 100)
  if (!title) throw new TableValidationError('表格名称不能为空')
  const sheetName = clean(input.sheetName ?? '', 100) || '数据'

  if (input.columns.length === 0) throw new TableValidationError('至少需要一列')
  if (input.columns.length > MAX_COLUMNS) throw new TableValidationError(`列数超过上限 ${MAX_COLUMNS}`)
  const columns: NormalizedColumn[] = []
  for (const raw of input.columns) {
    const name = clean(raw.name, 100)
    if (!name) throw new TableValidationError('列名不能为空')
    if (columns.some((c) => c.name === name)) throw new TableValidationError(`列名重复：${name}`)
    columns.push({ name, type: raw.type ?? 'text', options: [] })
  }
  // Every platform's primary (first) field is a text field; a non-text first column is written as text.
  if (columns[0] && columns[0].type !== 'text') {
    warnings.push(`第一列「${columns[0].name}」是主字段，已按文本写入`)
    columns[0].type = 'text'
  }

  if (input.rows.length > MAX_ROWS) throw new TableValidationError(`行数超过上限 ${MAX_ROWS}，请拆分后分批推送`)
  const byName = new Map(columns.map((c) => [c.name, c]))
  const unknown = new Set<string>()
  const invalid = new Map<string, number>()
  const rows: Array<Record<string, Cell>> = []
  for (const raw of input.rows) {
    const row: Record<string, Cell> = {}
    for (const [key, value] of Object.entries(raw)) {
      const column = byName.get(key.trim())
      if (!column) {
        unknown.add(key)
        continue
      }
      if (value === null || value === undefined || value === '') continue
      const cell = coerce(column.type, value)
      if (!cell) {
        invalid.set(column.name, (invalid.get(column.name) ?? 0) + 1)
        continue
      }
      row[column.name] = cell
      if (cell.type === 'select') addOption(column, cell.value)
      if (cell.type === 'multi_select') for (const v of cell.value) addOption(column, v)
    }
    if (Object.keys(row).length > 0) rows.push(row)
  }
  if (unknown.size > 0) warnings.push(`忽略了不在列定义里的键：${[...unknown].slice(0, 5).join('、')}`)
  for (const [name, count] of invalid) warnings.push(`「${name}」有 ${count} 个值与列类型不符，已留空`)
  const skipped = input.rows.length - rows.length
  if (skipped > 0) warnings.push(`${skipped} 行没有任何有效值，已跳过`)
  for (const column of columns) {
    if (column.options.length > MAX_SELECT_OPTIONS) {
      warnings.push(`「${column.name}」选项超过 ${MAX_SELECT_OPTIONS} 个，已按文本写入`)
      column.type = 'text'
      column.options = []
      for (const row of rows) {
        const cell = row[column.name]
        if (cell?.type === 'select') row[column.name] = { type: 'text', value: cell.value }
        if (cell?.type === 'multi_select') row[column.name] = { type: 'text', value: cell.value.join('、') }
      }
    }
  }
  return { title, sheetName, columns, rows, warnings }
}

function addOption(column: NormalizedColumn, value: string): void {
  if (!column.options.includes(value)) column.options.push(value)
}

function clean(value: string, max: number): string {
  const oneLine = value.replace(/[\r\n\t]+/g, ' ').trim()
  return [...oneLine].slice(0, max).join('')
}

function text(value: OfficeCellValue): string {
  if (Array.isArray(value)) return value.map(String).join('、')
  return String(value)
}

export function coerce(type: OfficeColumnType, value: OfficeCellValue): Cell | undefined {
  switch (type) {
    case 'text': {
      const v = text(value).slice(0, MAX_CELL_CHARS)
      return v.trim() ? { type, value: v } : undefined
    }
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? { type, value } : undefined
      if (typeof value !== 'string') return undefined
      const n = Number(value.replace(/[,，\s]/g, '').replace(/[¥￥$]/g, ''))
      return value.trim() && Number.isFinite(n) ? { type, value: n } : undefined
    }
    case 'date': {
      const parts = parseDate(value)
      return parts ? { type, value: parts } : undefined
    }
    case 'select': {
      const v = clean(Array.isArray(value) ? String(value[0] ?? '') : text(value), 100)
      return v ? { type, value: v } : undefined
    }
    case 'multi_select': {
      const list = (Array.isArray(value) ? value.map(String) : [text(value)]).map((v) => clean(v, 100)).filter(Boolean)
      const unique = [...new Set(list)]
      return unique.length > 0 ? { type, value: unique } : undefined
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return { type, value }
      if (typeof value === 'number') return { type, value: value !== 0 }
      const v = text(value).trim().toLowerCase()
      if (['true', 'yes', 'y', '1', '是', '对', '已完成', '完成', '√', '✓'].includes(v)) return { type, value: true }
      if (['false', 'no', 'n', '0', '否', '不是', '未完成', '×', '✗'].includes(v)) return { type, value: false }
      return undefined
    }
    case 'url': {
      const v = text(value).trim()
      return /^https?:\/\/\S+$/i.test(v) ? { type, value: v } : undefined
    }
  }
}

/**
 * Dates as the agent tends to write them: `2026-09-13`, `2026/9/13 14:05`, `2026-09-13T14:05:00+08:00`,
 * `2026年9月13日`, or epoch milliseconds. Offsets are converted to China Standard Time (UTC+8), the
 * zone every table is created in.
 */
export function parseDate(value: OfficeCellValue): DateParts | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? fromEpoch(value) : undefined
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  const withZone = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(v)
  if (withZone) {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? fromEpoch(ms) : undefined
  }
  const m =
    /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT]+(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*[:：分]\s*(\d{1,2}))?\s*秒?)?$/.exec(
      v,
    )
  if (!m) return undefined
  const parts: DateParts = {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] ? Number(m[4]) : 0,
    mm: m[5] ? Number(m[5]) : 0,
    ss: m[6] ? Number(m[6]) : 0,
    hasTime: Boolean(m[4]),
  }
  return validParts(parts) ? parts : undefined
}

const CST_OFFSET_MS = 8 * 3600_000

function fromEpoch(ms: number): DateParts | undefined {
  const d = new Date(ms + CST_OFFSET_MS)
  if (Number.isNaN(d.getTime())) return undefined
  const parts: DateParts = {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
    hasTime: true,
  }
  return validParts(parts) ? parts : undefined
}

function validParts(p: DateParts): boolean {
  if (p.y < 1900 || p.y > 2200 || p.m < 1 || p.m > 12 || p.hh > 23 || p.mm > 59 || p.ss > 59) return false
  const days = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate()
  return p.d >= 1 && p.d <= days
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD`, plus ` HH:mm` (and `:ss` when `seconds`) when the value carries a time or `forceTime`. */
export function formatDate(p: DateParts, opts: { seconds?: boolean; forceTime?: boolean } = {}): string {
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`
  if (!p.hasTime && !opts.forceTime) return date
  return `${date} ${pad(p.hh)}:${pad(p.mm)}${opts.seconds ? `:${pad(p.ss)}` : ''}`
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
