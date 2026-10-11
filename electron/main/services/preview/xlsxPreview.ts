/**
 * .xlsx → read-only sheet previews: cell values as display strings (shared / inline strings, numbers,
 * booleans, errors; date-formatted numbers as dates). Formulas show their cached result. Hidden sheets
 * are skipped; rows / columns / sheets past the caps are cut and the sheet says so.
 */
import { posix } from 'node:path'
import type { DocumentPreview, SheetPreview } from '@aiwc/protocol'
import { xmlEvents } from './xml'
import { readOfficePart, unreadableOfficeFile } from './officeZip'

const MAX_SHEETS = 20
const MAX_ROWS = 1000
const MAX_COLS = 60
const MS_PER_DAY = 86_400_000
/** Excel serial 25569 = 1970-01-01 in the 1900 date system. */
const EPOCH_1900 = 25_569
/** 1904 date system (old Mac workbooks): serial 0 = 1904-01-01. */
const EPOCH_1904 = 24_107

/** Built-in number formats that are dates / times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

/** Column letters → zero-based index (`A` → 0, `AA` → 26); -1 when malformed. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1]?.toUpperCase()
  if (!letters) return -1
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** True for a custom format code that renders a date or time (ignoring quoted text and colours). */
export function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
  return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare)
}

/** Excel serial → `YYYY-MM-DD` (plus ` HH:mm` when it has a time part), in the workbook's own clock. */
export function formatExcelDate(serial: number, date1904: boolean): string {
  const ms = Math.round((serial - (date1904 ? EPOCH_1904 : EPOCH_1900)) * MS_PER_DAY)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return serial % 1 === 0 ? day : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Shared strings: each <si>'s text runs joined; phonetic hints (<rPh>) are left out. */
export function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const out: string[] = []
  let current: string | undefined
  let inText = false
  let phonetic = 0
  for (const e of xmlEvents(xml)) {
    if (e.type === 'open') {
      if (e.name === 'si') {
        if (e.selfClosing) out.push('')
        else current = ''
      } else if (e.name === 'rPh' && !e.selfClosing) phonetic++
      else if (e.name === 't') inText = !e.selfClosing
    } else if (e.type === 'close') {
      if (e.name === 'si') {
        out.push(current ?? '')
        current = undefined
      } else if (e.name === 'rPh') phonetic = Math.max(0, phonetic - 1)
      else if (e.name === 't') inText = false
    } else if (inText && phonetic === 0 && current !== undefined) current += e.text
  }
  return out
}

/** Style index (cell `s`) → whether that cell format is a date. */
export function parseDateStyles(xml: string | undefined): (styleIndex: number) => boolean {
  if (!xml) return () => false
  const customDate = new Set<number>()
  const xfDate: boolean[] = []
  let inCellXfs = false
  for (const e of xmlEvents(xml)) {
    if (e.type === 'open' && e.name === 'numFmt') {
      const id = Number(e.attrs.numFmtId)
      if (Number.isInteger(id) && isDateFormatCode(e.attrs.formatCode ?? '')) customDate.add(id)
    } else if (e.type === 'open' && e.name === 'cellXfs') inCellXfs = !e.selfClosing
    else if (e.type === 'close' && e.name === 'cellXfs') inCellXfs = false
    else if (e.type === 'open' && e.name === 'xf' && inCellXfs) {
      const id = Number(e.attrs.numFmtId ?? 0)
      xfDate.push(BUILTIN_DATE_FORMATS.has(id) || customDate.has(id))
    }
  }
  return (i) => xfDate[i] ?? false
}

interface SheetRef {
  name: string
  target: string
}

/** Visible sheets in workbook order, with their part paths resolved from the workbook relationships. */
function parseWorkbook(file: Buffer): { sheets: SheetRef[]; date1904: boolean } {
  const workbook = readOfficePart(file, 'xl/workbook.xml', true)
  const rels = readOfficePart(file, 'xl/_rels/workbook.xml.rels') ?? ''
  const targets = new Map<string, string>()
  for (const e of xmlEvents(rels)) {
    if (e.type === 'open' && e.name === 'Relationship' && e.attrs.Id && e.attrs.Target)
      targets.set(e.attrs.Id, e.attrs.Target)
  }
  const sheets: SheetRef[] = []
  let date1904 = false
  for (const e of xmlEvents(workbook)) {
    if (e.type !== 'open') continue
    if (e.name === 'workbookPr') date1904 = ['1', 'true'].includes((e.attrs.date1904 ?? '').toLowerCase())
    if (e.name !== 'sheet') continue
    if (e.attrs.state === 'hidden' || e.attrs.state === 'veryHidden') continue
    const target = targets.get(e.attrs['r:id'] ?? '')
    if (!target) continue
    // Targets are relative to xl/ unless absolute within the package.
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target))
    sheets.push({ name: e.attrs.name ?? '', target: path })
  }
  return { sheets, date1904 }
}

interface CellContext {
  shared: string[]
  isDateStyle: (styleIndex: number) => boolean
  date1904: boolean
}

function cellDisplay(type: string | undefined, raw: string, style: number, ctx: CellContext): string {
  switch (type) {
    case 's':
      return ctx.shared[Number(raw)] ?? ''
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE'
    case 'str':
    case 'inlineStr':
    case 'e':
      return raw
    default: {
      const n = Number(raw)
      if (raw === '' || !Number.isFinite(n)) return raw
      return ctx.isDateStyle(style) ? formatExcelDate(n, ctx.date1904) : raw
    }
  }
}

/** One worksheet's cells as a dense grid, trailing empty rows / columns trimmed. */
export function parseSheetXml(xml: string, name: string, ctx: CellContext): SheetPreview {
  const rows: string[][] = []
  let truncated = false
  let rowIndex = -1
  let col = -1
  let type: string | undefined
  let style = 0
  let value = ''
  let capture = false
  let inInline = false
  for (const e of xmlEvents(xml)) {
    if (e.type === 'open') {
      if (e.name === 'row') {
        const r = Number(e.attrs.r)
        rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1
        col = -1
      } else if (e.name === 'c') {
        const fromRef = e.attrs.r ? columnIndex(e.attrs.r) : -1
        col = fromRef >= 0 ? fromRef : col + 1
        type = e.attrs.t
        style = Number(e.attrs.s ?? 0) || 0
        value = ''
      } else if (e.name === 'v') capture = !e.selfClosing
      else if (e.name === 'is') inInline = !e.selfClosing
      else if (e.name === 't' && inInline) capture = !e.selfClosing
    } else if (e.type === 'text') {
      if (capture) value += e.text
    } else if (e.name === 'v' || e.name === 't') capture = false
    else if (e.name === 'is') inInline = false
    else if (e.name === 'c') {
      if (rowIndex < 0 || col < 0) continue
      if (rowIndex >= MAX_ROWS || col >= MAX_COLS) {
        truncated = true
        continue
      }
      const text = cellDisplay(type, value, style, ctx)
      if (!text) continue
      while (rows.length <= rowIndex) rows.push([])
      const row = rows[rowIndex]
      if (!row) continue
      while (row.length <= col) row.push('')
      row[col] = text
    }
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const dense = rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r))
  while (dense.length && dense[dense.length - 1]?.every((c) => !c)) dense.pop()
  return { name, rows: dense, truncated }
}

/** Parse a .xlsx file. Throws (localized) when it is not a readable workbook. */
export function previewXlsx(file: Buffer): DocumentPreview {
  const { sheets, date1904 } = parseWorkbook(file)
  if (!sheets.length) throw unreadableOfficeFile()
  const ctx: CellContext = {
    shared: parseSharedStrings(readOfficePart(file, 'xl/sharedStrings.xml')),
    isDateStyle: parseDateStyles(readOfficePart(file, 'xl/styles.xml')),
    date1904,
  }
  const out: SheetPreview[] = []
  // A workbook never points two sheets at one part; a crafted one does it to multiply the parsing work.
  const seenTargets = new Set<string>()
  const unique = sheets.filter((s) => {
    const key = s.target.toLowerCase()
    if (seenTargets.has(key)) return false
    seenTargets.add(key)
    return true
  })
  for (const sheet of unique.slice(0, MAX_SHEETS)) {
    const xml = readOfficePart(file, sheet.target)
    out.push(xml ? parseSheetXml(xml, sheet.name, ctx) : { name: sheet.name, rows: [], truncated: false })
  }
  const last = out[out.length - 1]
  if (unique.length > MAX_SHEETS && last) last.truncated = true
  return { kind: 'xlsx', sheets: out }
}
