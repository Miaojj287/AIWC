/**
 * CSV / TSV for the file Tab's table preview: RFC 4180 quoting (quoted fields may hold the delimiter,
 * doubled quotes and line breaks), CRLF or LF, an optional UTF-8 BOM. Rows past the cap are dropped and
 * reported, so a huge export never builds a huge DOM.
 */

/** Rows shown in the preview (the header included). */
export const MAX_CSV_ROWS = 2000
/** Columns shown per row. */
export const MAX_CSV_COLS = 100

export interface ParsedTable {
  rows: string[][]
  /** Rows or columns were left out. */
  truncated: boolean
}

/** `\t` for .tsv files, `,` otherwise. */
export function delimiterFor(path: string): ',' | '\t' {
  return /\.tsv$/i.test(path) ? '\t' : ','
}

export function parseDelimited(text: string, delimiter: string = ','): ParsedTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let truncated = false
  let i = 0

  const endField = () => {
    if (row.length < MAX_CSV_COLS) row.push(field)
    else truncated = true
    field = ''
  }
  const endRow = (): boolean => {
    endField()
    rows.push(row)
    row = []
    if (rows.length >= MAX_CSV_ROWS) {
      truncated ||= i < src.length
      return false
    }
    return true
  }

  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
      i++
    } else if (ch === delimiter) {
      endField()
      i++
    } else if (ch === '\r' || ch === '\n') {
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      if (!endRow()) return { rows, truncated }
    } else {
      field += ch
      i++
    }
  }
  if (field !== '' || row.length > 0) endRow()
  return { rows, truncated }
}
