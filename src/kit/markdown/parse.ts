/**
 * Block half of the kit Markdown parser: source → block AST. Data only — Markdown.tsx renders it, so no HTML is
 * ever injected. One parser for every surface: Agent replies (streamed) and Markdown files.
 *
 * Blocks: ATX headings, paragraphs, bullet / ordered lists (a line indented under an item belongs to it: its
 * continuation, a nested list, code or a table), block quotes holding blocks, fenced code, rules and GFM pipe
 * tables with column alignment.
 *
 * Streaming-safe: an unterminated fence renders as code to the end, and a table is recognised only once its
 * delimiter row has as many cells as its header row — until then those lines read as a paragraph.
 */
import { parseInline, type MarkdownInline } from './inline'

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** Column alignment from the delimiter row: `:--` left, `:-:` center, `--:` right, `---` none. */
export type MarkdownAlign = 'left' | 'center' | 'right' | undefined

/** One table cell: its Markdown as written (pipes still escaped) and the parsed inline content. */
export interface MarkdownTableCell {
  source: string
  children: MarkdownInline[]
}

export interface MarkdownTable {
  type: 'table'
  align: MarkdownAlign[]
  header: MarkdownTableCell[]
  /** Every row has exactly `header.length` cells: short rows are padded, extra cells dropped (GFM). */
  rows: MarkdownTableCell[][]
}

export type MarkdownBlock =
  | { type: 'heading'; level: MarkdownHeadingLevel; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  /** Each item is its own block list: the item's text, then whatever is indented under it. */
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'quote'; children: MarkdownBlock[] }
  | { type: 'rule' }
  | MarkdownTable

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
/** `# C#` keeps its `#`: a closing sequence needs whitespace before it. */
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^[ \t]{0,3}>[ \t]?(.*)$/
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/
const DELIMITER_CELL = /^:?-+:?$/
const ESCAPED_PIPE = /\\\|/g
/** A line indented this far past its list marker belongs to the item above (continuation, nested list, code). */
const NEST_INDENT = 2
/** At most this much whitespace after a list marker counts towards the item's content column. */
const MAX_MARKER_GAP = 4

const isBlank = (line: string) => line.trim() === ''
const indentOf = (line: string) => line.length - line.trimStart().length
/** Paragraph text keeps ideographic spaces (a Chinese first-line indent); only ASCII blanks are trimmed. */
const trimBlanks = (text: string) => text.replace(/^[ \t]+|[ \t]+$/g, '')

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'))
}

function parseBlocks(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = openFence(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !closesFence(lines[i] ?? '', fence)) {
        code.push(stripIndent(lines[i] ?? '', fence.indent))
        i++
      }
      i++ // the closing fence; past the end while the block is still streaming
      blocks.push({ type: 'code', lang: fence.lang, code: code.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1]?.length ?? 1) as MarkdownHeadingLevel
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      for (let q = QUOTE.exec(lines[i] ?? ''); q; q = QUOTE.exec(lines[i] ?? '')) {
        inner.push(q[1] ?? '')
        i++
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner) })
      continue
    }

    const marker = listMarker(line)
    if (marker) {
      const list = parseList(lines, i, marker)
      blocks.push(list.block)
      i = list.next
      continue
    }

    const table = tableStart(lines, i)
    if (table) {
      const parsed = parseTable(lines, i, table)
      blocks.push(parsed.block)
      i = parsed.next
      continue
    }

    const para = [line]
    i++
    while (i < lines.length && !interruptsParagraph(lines, i)) {
      para.push(lines[i] ?? '')
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(trimBlanks(para.join('\n'))) })
  }
  return blocks
}

/** A line that ends the paragraph above it: a blank line or the start of another block (a table included). */
function interruptsParagraph(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? ''
  return isBlank(line) || startsBlock(line) || tableStart(lines, i) !== undefined
}

function startsBlock(line: string): boolean {
  return (
    openFence(line) !== undefined ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    listMarker(line) !== undefined
  )
}

/* ------------------------------------------------------------------ fenced code */

interface Fence {
  indent: number
  char: string
  length: number
  lang?: string
}

function openFence(line: string): Fence | undefined {
  const m = FENCE_OPEN.exec(line)
  if (!m) return undefined
  const [, indent = '', marker = '', info = ''] = m
  // ```js` on one line is inline code, not a fence (a backtick fence's info string has no backticks).
  if (marker.startsWith('`') && info.includes('`')) return undefined
  return {
    indent: indent.length,
    char: marker.charAt(0),
    length: marker.length,
    lang: info.trim().split(/\s+/)[0] || undefined,
  }
}

/** Closed by a bare run of the same character, at least as long as the opening one (a `` ```js `` line is content). */
function closesFence(line: string, fence: Fence): boolean {
  const run = FENCE_CLOSE.exec(line)?.[1]
  return run !== undefined && run.startsWith(fence.char) && run.length >= fence.length
}

function stripIndent(line: string, n: number): string {
  return line.slice(Math.min(n, indentOf(line)))
}

/* ------------------------------------------------------------------ lists */

interface ListMarker {
  indent: number
  ordered: boolean
  start: number
  /** The item's first line, after the marker. */
  text: string
  /** Column where the item's content starts; lines indented under it are de-indented by this much. */
  contentColumn: number
}

function listMarker(line: string): ListMarker | undefined {
  if (RULE.test(line)) return undefined // `- - -` / `* * *` are rules
  const m = LIST_ITEM.exec(line)
  if (!m) return undefined
  const [, lead = '', bullet = '', gap = '', text = ''] = m
  const ordered = /\d/.test(bullet)
  return {
    indent: lead.length,
    ordered,
    start: ordered ? Number.parseInt(bullet, 10) : 1,
    text,
    contentColumn: lead.length + bullet.length + Math.min(gap.length, MAX_MARKER_GAP),
  }
}

/**
 * One list: siblings share the marker kind and sit less than NEST_INDENT past the first marker. A line indented
 * further belongs to the current item; an unindented non-item line ends the list. Blank lines between items keep
 * one (loose) list; a blank line inside an item continues it only when the next text is indented under it.
 */
function parseList(lines: readonly string[], start: number, first: ListMarker): { block: MarkdownBlock; next: number } {
  const nestAt = first.indent + NEST_INDENT
  const items: MarkdownBlock[][] = []
  let marker: ListMarker | undefined = first
  let i = start
  while (marker) {
    const body = [marker.text]
    i++
    while (i < lines.length) {
      const line = lines[i] ?? ''
      if (isBlank(line)) {
        const next = nextNonBlank(lines, i)
        if (next >= lines.length || indentOf(lines[next] ?? '') < nestAt) break
        for (; i < next; i++) body.push('')
        continue
      }
      const indent = indentOf(line)
      if (indent < nestAt) break
      body.push(line.slice(Math.min(indent, marker.contentColumn)))
      i++
    }
    items.push(parseBlocks(body))
    const next = nextNonBlank(lines, i)
    const sibling = next < lines.length ? listMarker(lines[next] ?? '') : undefined
    if (sibling && sibling.ordered === first.ordered && sibling.indent < nestAt) {
      i = next
      marker = sibling
    } else marker = undefined
  }
  return { block: { type: 'list', ordered: first.ordered, start: first.start, items }, next: i }
}

function nextNonBlank(lines: readonly string[], from: number): number {
  let i = from
  while (i < lines.length && isBlank(lines[i] ?? '')) i++
  return i
}

/* ------------------------------------------------------------------ tables */

interface TableHead {
  header: string[]
  align: MarkdownAlign[]
}

/** The header and alignment when `lines[i]` and the line after it open a table: same cell count, pipes in both. */
function tableStart(lines: readonly string[], i: number): TableHead | undefined {
  const head = lines[i]
  const delimiter = lines[i + 1]
  if (head === undefined || delimiter === undefined || !head.includes('|') || !delimiter.includes('|')) return undefined
  const align = delimiterRow(delimiter)
  if (!align) return undefined
  const header = splitRow(head)
  return header.length === align.length ? { header, align } : undefined
}

function delimiterRow(line: string): MarkdownAlign[] | undefined {
  const align: MarkdownAlign[] = []
  for (const cell of splitRow(line)) {
    if (!DELIMITER_CELL.test(cell)) return undefined
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : undefined)
  }
  return align
}

/** Rows run until a blank line, a line without a pipe, or the start of another block. */
function parseTable(lines: readonly string[], start: number, head: TableHead): { block: MarkdownTable; next: number } {
  const width = head.header.length
  const rows: MarkdownTableCell[][] = []
  let i = start + 2
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line) || !line.includes('|') || startsBlock(line)) break
    const cells = splitRow(line).slice(0, width)
    while (cells.length < width) cells.push('')
    rows.push(cells.map(tableCell))
    i++
  }
  return { block: { type: 'table', align: head.align, header: head.header.map(tableCell), rows }, next: i }
}

/** `\|` is a literal pipe everywhere in a cell, code spans included (GFM unescapes it before inline parsing). */
function tableCell(source: string): MarkdownTableCell {
  return { source, children: parseInline(source.replace(ESCAPED_PIPE, '|')) }
}

/** Cells of one row: outer pipes optional, `\|` stays inside its cell. */
function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let k = 0; k < row.length; k++) {
    const ch = row.charAt(k)
    if (ch === '\\' && row.charAt(k + 1) === '|') {
      cell += '\\|'
      k++
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += ch
  }
  cells.push(cell.trim())
  return cells
}
