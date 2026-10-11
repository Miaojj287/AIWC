/**
 * Text forms of a parsed Markdown table for the table `···` menu: Markdown (each cell as written), TSV for pasting
 * into Excel / Google Sheets / Feishu, and RFC 4180 CSV for a file. Pure functions.
 *
 * TSV and CSV carry each cell's plain text: formatting dropped, a link reduced to its label (an evidence citation
 * keeps its "02-14 19:28"). Table text may quote third-party chat messages, so a cell a spreadsheet would run as a
 * formula (`=…`, `+…`, `-…`, `@…`) gets a leading `'`; plain numbers such as -5 or +3.2% are left alone.
 */
import { inlineText } from './inline'
import type { MarkdownAlign, MarkdownTable } from './parse'

const DELIMITER: Readonly<Record<NonNullable<MarkdownAlign>, string>> = { left: ':--', center: ':-:', right: '--:' }
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/
const CSV_NEEDS_QUOTES = /[",\r\n]/
const LINE_BREAKS_AND_TABS = /[\t\r\n]+/g

/** The table as GFM pipe-table Markdown: cells as written, short rows padded, alignment kept. */
export function tableToMarkdown(table: MarkdownTable): string {
  const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
  return [
    row(table.header.map((cell) => cell.source)),
    row(table.align.map((align) => (align ? DELIMITER[align] : '---'))),
    ...table.rows.map((cells) => row(cells.map((cell) => cell.source))),
  ].join('\n')
}

/** Tab-separated plain text, one line per row; a field holding `"` is quoted the way spreadsheets read it back. */
export function tableToTsv(table: MarkdownTable): string {
  return plainRows(table)
    .map((cells) => cells.map(tsvField).join('\t'))
    .join('\n')
}

/** RFC 4180 CSV: comma-separated fields, CRLF after every row (no BOM; the writer adds one for Excel). */
export function tableToCsv(table: MarkdownTable): string {
  return plainRows(table)
    .map((cells) => `${cells.map(csvField).join(',')}\r\n`)
    .join('')
}

/** One RFC 4180 field: quoted when it holds a comma, quote, CR or LF, with inner quotes doubled. */
function csvField(text: string): string {
  const safe = neutralizeFormula(text)
  return CSV_NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function tsvField(text: string): string {
  const flat = neutralizeFormula(text.replace(LINE_BREAKS_AND_TABS, ' '))
  return flat.includes('"') ? `"${flat.replace(/"/g, '""')}"` : flat
}

function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text
}

function plainRows(table: MarkdownTable): string[][] {
  return [table.header, ...table.rows].map((cells) => cells.map((cell) => inlineText(cell.children)))
}
