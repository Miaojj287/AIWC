/**
 * Minimal Markdown → block AST for Agent replies. Deliberately small (no external lib, no HTML
 * passthrough): headings, paragraphs, bullet / ordered lists, fenced code, block quotes, rules, and
 * inline bold / italic / code / links. Streaming-safe: an unterminated fence renders as code.
 */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export type Block =
  | { type: 'heading'; level: HeadingLevel; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'rule' }

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  let para: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) })
    para = []
  }

  while (i < lines.length) {
    const line = lines[i] as string

    const fence = FENCE.exec(line)
    if (fence) {
      flushPara()
      const marker = fence[1] as string
      const lang = fence[2] || undefined
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] as string).trimEnd().startsWith(marker) ) {
        code.push(lines[i] as string)
        i++
      }
      i++ // closing fence (or EOF)
      blocks.push({ type: 'code', lang, code: code.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flushPara()
      i++
      continue
    }

    if (RULE.test(line)) {
      flushPara()
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      blocks.push({ type: 'heading', level: Math.min(6, (heading[1] as string).length) as HeadingLevel, children: parseInline(heading[2] as string) })
      i++
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet || ordered) {
      flushPara()
      const isOrdered = Boolean(ordered)
      const start = ordered ? Number(ordered[1]) : 1
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i] as string
        const b = BULLET.exec(l)
        const o = ORDERED.exec(l)
        if (isOrdered ? o : b) {
          items.push((isOrdered ? o : b)![isOrdered ? 2 : 1] as string)
          i++
        } else if (l.trim() !== '' && /^\s{2,}/.test(l) && items.length > 0 && !FENCE.test(l)) {
          // lazy continuation of the previous item
          items[items.length - 1] = `${items[items.length - 1]} ${l.trim()}`
          i++
        } else break
      }
      blocks.push({ type: 'list', ordered: isOrdered, start, items: items.map(parseInline) })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flushPara()
      const parts: string[] = []
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] as string)
        if (!q) break
        parts.push(q[1] as string)
        i++
      }
      blocks.push({ type: 'quote', children: parseInline(parts.join('\n')) })
      continue
    }

    para.push(line)
    i++
  }
  flushPara()
  return blocks
}

/* ------------------------------------------------------------------ inline */

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string

    if (ch === '\\' && i + 1 < src.length) {
      text += src[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      const close = src.indexOf(ticks, i + run)
      if (close > i) {
        flush()
        out.push({ type: 'code', text: src.slice(i + run, close).replace(/^ (.*) $/, '$1') })
        i = close + run
        continue
      }
    }

    if ((ch === '*' || ch === '_') && canOpen(src, i, ch)) {
      const double = src[i + 1] === ch
      const marker = double ? ch + ch : ch
      const close = findClosing(src, i + marker.length, marker)
      if (close > i + marker.length) {
        flush()
        const inner = src.slice(i + marker.length, close)
        out.push(double ? { type: 'bold', children: parseInline(inner) } : { type: 'italic', children: parseInline(inner) })
        i = close + marker.length
        continue
      }
    }

    if (ch === '[') {
      const m = LINK.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', text: m[1] as string, href: m[2] as string })
        i += m[0].length
        continue
      }
    }

    text += ch
    i++
  }
  flush()
  return out
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/**
 * Opening marker: not followed by whitespace; `_` additionally must not sit inside a word
 * (snake_case stays literal, as in CommonMark).
 */
function canOpen(src: string, i: number, ch: string): boolean {
  const run = src[i + 1] === ch ? 2 : 1
  const next = src[i + run]
  if (next === undefined || /\s/.test(next)) return false
  if (ch === '_' && isWordChar(src[i - 1])) return false
  return true
}

/** Closing emphasis marker: same run, not preceded by whitespace, not inside a backtick span; `_` must end the word. */
function findClosing(src: string, from: number, marker: string): number {
  let i = from
  while (i < src.length) {
    if (src[i] === '`') {
      const close = src.indexOf('`', i + 1)
      if (close < 0) return -1
      i = close + 1
      continue
    }
    if (src.startsWith(marker, i) && !/\s/.test(src[i - 1] as string) && (i + marker.length >= src.length || src[i + marker.length] !== marker[0])) {
      if (marker[0] === '_' && isWordChar(src[i + marker.length])) {
        i++
        continue
      }
      return i
    }
    i++
  }
  return -1
}

/** Plain text of a block list (clipboard, tests). */
export function inlineToText(inlines: Inline[]): string {
  return inlines.map((n) => (n.type === 'text' || n.type === 'code' || n.type === 'link' ? n.text : inlineToText(n.children))).join('')
}
