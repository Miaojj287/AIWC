/**
 * Inline half of the kit Markdown parser: text → inline AST. Data only — no HTML is produced or passed through;
 * Markdown.tsx turns the nodes into React elements.
 *
 * Covers **strong** / __strong__, *em* / _em_, `code` (any backtick run), [links](href "title"), ![images](src)
 * (a link labelled with the alt text), bare http(s) URLs and <https://…>, backslash escapes of ASCII punctuation,
 * hard breaks (two trailing spaces or a trailing backslash) and soft breaks, which stay in the text as "\n" so a
 * surface can show them (Agent replies) or let them collapse to a space (standard Markdown).
 *
 * Emphasis keeps chat text literal: a marker followed by whitespace never opens, `_` inside a word (snake_case)
 * never opens or closes, and an unclosed marker stays as typed, so a half-streamed `**bold` reads as text until
 * its closing marker arrives.
 */
export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  /** `image`: written as ![alt](src) — a surface that can show images (Markdown `resolveImage`) draws it. */
  | { type: 'link'; href: string; children: MarkdownInline[]; image?: true }
  | { type: 'break' }

/** ASCII punctuation: the only characters a backslash escapes, so a Windows path keeps its backslashes. */
const ESCAPABLE = /^[!-/:-@[-`{-~]$/
const LINK = /^(!?)\[([^\]]*)\]\(\s*<?([^\s<>)]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/
/** ASCII URL characters only: Chinese text or full-width punctuation right after a URL stays outside the link. */
const BARE_URL = /^https?:\/\/[\w\-.~:/?#@!$&'*+,;=%]+/
const ANGLE_URL = /^<(https?:\/\/[^\s<>]+)>/
const URL_TRAILING_PUNCTUATION = /[.,;:!?'*]+$/
const URL_SCHEME_ONLY = /^https?:\/\/$/
/** Longest link / URL looked at from one position: bounds the work per `[` in a long, bracket-heavy reply. */
const MAX_LINK_CHARS = 4096
const TRAILING_SPACES = /[ \t]+$/
const HARD_BREAK_SPACES = / {2,}$/

export function parseInline(src: string): MarkdownInline[] {
  return parse(src, true)
}

/** `links` is false inside a link label: links never nest. */
function parse(src: string, links: boolean): MarkdownInline[] {
  const out: MarkdownInline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  /** Ends the current line and returns where the next one's text starts (its indentation is dropped). */
  const endLine = (hard: boolean, next: number): number => {
    text = text.replace(TRAILING_SPACES, '')
    if (hard) {
      flush()
      out.push({ type: 'break' })
    } else text += '\n'
    let at = next
    while (src[at] === ' ' || src[at] === '\t') at++
    return at
  }

  let i = 0
  while (i < src.length) {
    const ch = src.charAt(i)

    if (ch === '\n') {
      i = endLine(HARD_BREAK_SPACES.test(text), i + 1)
      continue
    }

    if (ch === '\\') {
      const next = src[i + 1]
      if (next === '\n') {
        i = endLine(true, i + 2)
        continue
      }
      if (next !== undefined && ESCAPABLE.test(next)) {
        text += next
        i += 2
        continue
      }
    }

    if (ch === '`') {
      const span = codeSpanAt(src, i)
      if (span) {
        flush()
        out.push({ type: 'code', text: span.text })
        i = span.end
        continue
      }
      // An unmatched run stays literal as a whole, so its second tick cannot open a span of its own.
      const run = runLength(src, i, '`')
      text += src.slice(i, i + run)
      i += run
      continue
    }

    if ((ch === '*' || ch === '_') && canOpen(src, i, ch)) {
      const marker = src[i + 1] === ch ? ch + ch : ch
      const close = findClosing(src, i + marker.length, marker)
      if (close > i + marker.length) {
        flush()
        const children = parse(src.slice(i + marker.length, close), links)
        out.push(marker.length === 2 ? { type: 'strong', children } : { type: 'em', children })
        i = close + marker.length
        continue
      }
    }

    if (links && (ch === '[' || (ch === '!' && src[i + 1] === '['))) {
      const m = LINK.exec(src.slice(i, i + MAX_LINK_CHARS))
      if (m) {
        const [whole, bang, label = '', href = ''] = m
        flush()
        out.push({
          type: 'link',
          href,
          children: bang || !label ? [{ type: 'text', text: label || href }] : parse(label, false),
          ...(bang ? { image: true as const } : {}),
        })
        i += whole.length
        continue
      }
    }

    if (links && ch === '<') {
      const m = ANGLE_URL.exec(src.slice(i, i + MAX_LINK_CHARS))
      if (m?.[1]) {
        flush()
        out.push(urlLink(m[1]))
        i += m[0].length
        continue
      }
    }

    if (links && ch === 'h' && !isAsciiWordChar(src[i - 1])) {
      const url = bareUrlAt(src, i)
      if (url) {
        flush()
        out.push(urlLink(url))
        i += url.length
        continue
      }
    }

    text += ch
    i++
  }
  flush()
  return out
}

const urlLink = (url: string): MarkdownInline => ({ type: 'link', href: url, children: [{ type: 'text', text: url }] })

function bareUrlAt(src: string, i: number): string | undefined {
  if (!src.startsWith('http://', i) && !src.startsWith('https://', i)) return undefined
  const m = BARE_URL.exec(src.slice(i, i + MAX_LINK_CHARS))
  if (!m) return undefined
  const url = m[0].replace(URL_TRAILING_PUNCTUATION, '')
  return URL_SCHEME_ONLY.test(url) ? undefined : url
}

function runLength(src: string, from: number, ch: string): number {
  let n = 0
  while (src[from + n] === ch) n++
  return n
}

/** A code span opened by the backtick run at `i`: closed by a run of the same length (CommonMark). */
function codeSpanAt(src: string, i: number): { text: string; end: number } | undefined {
  const run = runLength(src, i, '`')
  let from = i + run
  for (;;) {
    const at = src.indexOf('`', from)
    if (at < 0) return undefined
    const closing = runLength(src, at, '`')
    if (closing === run) {
      let text = src.slice(i + run, at).replace(/\n/g, ' ')
      if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim()) text = text.slice(1, -1)
      return { text, end: at + run }
    }
    from = at + closing
  }
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)
const isAsciiWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c)

/** Opening marker: not followed by whitespace; `_` additionally must not sit inside a word (snake_case stays literal). */
function canOpen(src: string, i: number, ch: string): boolean {
  const run = src[i + 1] === ch ? 2 : 1
  const next = src[i + run]
  if (next === undefined || /\s/.test(next)) return false
  if (ch === '_' && isWordChar(src[i - 1])) return false
  return true
}

/** A run at `i` can close: not preceded by whitespace, and a `_` run must end its word. */
function canClose(src: string, i: number, run: number, ch: string): boolean {
  const prev = src[i - 1]
  if (prev === undefined || /\s/.test(prev)) return false
  return ch !== '_' || !isWordChar(src[i + run])
}

/**
 * Where `marker` closes, skipping code spans and escapes. A longer closing run closes with its last characters
 * (`***a***` = strong around em); a nested `**…**` inside `*…*` is stepped over as a whole.
 */
function findClosing(src: string, from: number, marker: string): number {
  const ch = marker.charAt(0)
  let i = from
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      i = codeSpanAt(src, i)?.end ?? i + runLength(src, i, '`')
      continue
    }
    if (c !== ch) {
      i++
      continue
    }
    const run = runLength(src, i, ch)
    if (run >= marker.length && canClose(src, i, run, ch)) return i + run - marker.length
    if (marker.length === 1 && run === 2 && canOpen(src, i, ch)) {
      const end = findClosing(src, i + 2, ch + ch)
      if (end > i + 2) {
        i = end + 2
        continue
      }
    }
    i += run
  }
  return -1
}

/** Plain text of an inline run: formatting dropped, a link reduced to its label, a hard break as "\n". */
export function inlineText(nodes: readonly MarkdownInline[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.text
        break
      case 'break':
        out += '\n'
        break
      case 'strong':
      case 'em':
      case 'link':
        out += inlineText(node.children)
        break
    }
  }
  return out
}
