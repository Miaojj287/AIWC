/**
 * Minimal, dependency-free Markdown → AST parser for previews (files the Agent generates, diaries).
 * Covers: ATX headings, paragraphs, bullet / ordered lists (nested by indent), fenced code, blockquotes,
 * hr, pipe tables; inline: **strong**, *em*, `code`, [link](url), ![img](src) (as link text), autolinks.
 * Output is data only — rendering (React) happens in Markdown.tsx, so no HTML is ever injected.
 * TODO: replace with the Agent feature's renderer once `@/features/agent` exports one.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' }

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'code'; lang?: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; header: Inline[][]; align: Array<'left' | 'center' | 'right' | undefined>; rows: Inline[][][] }

const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

const isBlank = (line: string) => line.trim() === ''

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'))
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line)) {
      i++
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1] ?? '```'
      const lang = fence[2] || undefined
      const body: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker.slice(0, 3))) {
        body.push(lines[i] ?? '')
        i++
      }
      i++ // closing fence (or EOF)
      blocks.push({ t: 'code', lang, v: body.join('\n') })
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ t: 'heading', level: Math.min(6, heading[1]?.length ?? 1) as Block extends { level: infer L } ? L : never, c: parseInline(heading[2] ?? '') })
      i++
      continue
    }
    if (HR_RE.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE_RE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i] ?? '')) {
        inner.push(QUOTE_RE.exec(lines[i] ?? '')?.[1] ?? '')
        i++
      }
      blocks.push({ t: 'quote', c: parseBlocks(inner) })
      continue
    }
    const list = LIST_RE.exec(line)
    if (list) {
      const { block, next } = parseList(lines, i)
      blocks.push(block)
      i = next
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1] ?? '').map((cell) => {
        const c = cell.trim()
        if (c.startsWith(':') && c.endsWith(':')) return 'center' as const
        if (c.endsWith(':')) return 'right' as const
        if (c.startsWith(':')) return 'left' as const
        return undefined
      })
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && !isBlank(lines[i] ?? '') && (lines[i] ?? '').includes('|')) {
        rows.push(splitRow(lines[i] ?? '').map(parseInline))
        i++
      }
      blocks.push({ t: 'table', header: header.map(parseInline), align, rows })
      continue
    }
    // paragraph: until blank line or the start of another block
    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const l = lines[i] ?? ''
      if (isBlank(l) || FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l)) break
      para.push(l)
      i++
    }
    blocks.push({ t: 'paragraph', c: parseParagraph(para) })
  }
  return blocks
}

function parseParagraph(lines: string[]): Inline[] {
  const out: Inline[] = []
  lines.forEach((l, idx) => {
    const hard = /\s{2,}$/.test(l) || /\\$/.test(l)
    out.push(...parseInline(l.replace(/(\s{2,}|\\)$/, '').trim()))
    if (idx < lines.length - 1) out.push(hard ? { t: 'br' } : { t: 'text', v: ' ' })
  })
  return mergeText(out)
}

function mergeText(items: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (it.t === 'text' && last?.t === 'text') last.v += it.v
    else out.push(it)
  }
  return out
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_RE.exec(lines[start] ?? '')
  const baseIndent = first?.[1]?.length ?? 0
  const ordered = /\d/.test(first?.[2] ?? '')
  const startNum = ordered ? Number.parseInt(first?.[2] ?? '1', 10) || 1 : 1
  const items: Block[][] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const m = LIST_RE.exec(line)
    if (!m || (m[1]?.length ?? 0) !== baseIndent || /\d/.test(m[2] ?? '') !== ordered) break
    const itemLines: string[] = [m[3] ?? '']
    i++
    // continuation: indented lines (or blank lines followed by indented lines) belong to this item
    while (i < lines.length) {
      const l = lines[i] ?? ''
      if (isBlank(l)) {
        const nxt = lines[i + 1]
        if (nxt !== undefined && !isBlank(nxt) && leadingSpaces(nxt) > baseIndent) {
          itemLines.push('')
          i++
          continue
        }
        break
      }
      const sub = LIST_RE.exec(l)
      if (sub && (sub[1]?.length ?? 0) <= baseIndent) break
      if (leadingSpaces(l) <= baseIndent && !sub) break
      itemLines.push(l.slice(Math.min(leadingSpaces(l), baseIndent + 2)))
      i++
    }
    items.push(parseBlocks(itemLines))
  }
  return { block: { t: 'list', ordered, start: startNum, items }, next: i }
}

const leadingSpaces = (l: string) => l.length - l.trimStart().length

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

const LINK_RE = /^!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/
const URL_RE = /^https?:\/\/[^\s<>()]+/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    const two = src.slice(i, i + 2)
    if (two === '**' || two === '__') {
      const end = findClose(src, two, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ch && src[i + 1] !== ' ') {
      const end = findClose(src, ch, i + 1)
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush()
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const m = LINK_RE.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ t: 'link', href: m[2] ?? '', c: ch === '!' ? [{ t: 'text', v: m[1] ?? '' }] : parseInline(m[1] ?? '') })
        i += m[0].length
        continue
      }
    }
    if (ch === 'h' && (src.startsWith('http://', i) || src.startsWith('https://', i))) {
      const m = URL_RE.exec(src.slice(i))
      if (m) {
        let url = m[0]
        while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1)
        flush()
        out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] })
        i += url.length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return mergeText(out)
}

/** Index of the next `marker` at or after `from` that is not immediately preceded by a backslash. */
function findClose(src: string, marker: string, from: number): number {
  let idx = src.indexOf(marker, from)
  while (idx >= 0 && src[idx - 1] === '\\') idx = src.indexOf(marker, idx + marker.length)
  return idx
}

/** Plain text of an inline run (used for headings / anchors / previews). */
export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? '\n' : inlineText(n.c))).join('')
}
