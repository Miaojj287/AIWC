/**
 * Evidence citations: the one format the Agent uses to point at a chat message, and the one check of
 * whether the words it put in quotation marks are really in that message. Shared by the tools (which
 * emit `cite`), the Agent panel (which renders a chip and colours it by the check) and the host's
 * Stop-hook audit (which asks the model to correct a quote that does not match before the turn ends).
 *
 * Format: `[02-14 19:28](wx://<sessionId>/<messageId>)`. Message ids are unique per session only, so the
 * link always carries both.
 */
import type { WxMessage } from './substrate'

export const CITATION_SCHEME = 'wx://'

export interface CitationRef {
  sessionId: string
  messageId: string
}

export function formatCitation(anchor: CitationRef, label: string): string {
  return `[${label}](${CITATION_SCHEME}${anchor.sessionId}/${anchor.messageId})`
}

export function isCitationHref(href: string): boolean {
  return href.startsWith(CITATION_SCHEME)
}

export function parseCitationHref(href: string): CitationRef | undefined {
  if (!isCitationHref(href)) return undefined
  const rest = href.slice(CITATION_SCHEME.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return undefined
  return { sessionId: rest.slice(0, slash), messageId: rest.slice(slash + 1) }
}

/** Opening quotation mark → its closing mark, for the marks a Chinese or English reply may put around verbatim text. */
const QUOTE_MARKS: ReadonlyMap<string, string> = new Map([
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['‘', '’'],
  ['"', '"'],
])

/** Quotes shorter than this (in characters, before normalization) carry too little to check. */
const MIN_QUOTE_CHARS = 2

/** A quoted segment and where it sits in the text it was found in (`end` is just past the closing mark). */
export interface QuoteSpan {
  text: string
  start: number
  end: number
}

/** Quoted segments of `text` in reading order; a quote nested inside another counts once, as the outer one. */
export function quoteSpans(text: string): QuoteSpan[] {
  const out: QuoteSpan[] = []
  let i = 0
  while (i < text.length) {
    const close = QUOTE_MARKS.get(text[i]!)
    const end = close === undefined ? -1 : text.indexOf(close, i + 1)
    if (end < 0) {
      i++
      continue
    }
    const inner = text.slice(i + 1, end).trim()
    if ([...inner].length >= MIN_QUOTE_CHARS) out.push({ text: inner, start: i, end: end + 1 })
    i = end + 1
  }
  return out
}

/** Zero-width / format characters and emoji variation selectors: invisible, but they would break a match. */
const INVISIBLE = /[\p{Cf}︀-️]/gu
/** WeChat emoji codes and the tools' media placeholders: `[捂脸]`, `[语音]`, `[Facepalm]`. */
const BRACKET_CODE = /\[[^[\]\n]{1,12}\]/g
/** A sender written inside the quote: 「庄曼琦：今天会有下午茶吗」. */
const SENDER_PREFIX = /^[^：:\n「」“”]{1,20}[：:]\s*/
/** An elision inside a quote: the parts on both sides must appear, in order. */
const ELLIPSIS = /…+|\.{3,}|⋯+/

/** Case-, width-, punctuation- and invisible-character-insensitive form used for containment checks. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(INVISIBLE, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

type MatchableMessage = Pick<WxMessage, 'text' | 'media' | 'quote' | 'rich'>

/** Everything a message "says": its text, a voice transcript, a file name, a link title and the quoted reply. */
export function messageHaystack(message: MatchableMessage): string {
  return [
    message.text,
    message.media?.transcript,
    message.media?.fileName,
    message.rich?.title,
    message.rich?.description,
    message.quote?.text,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The message normalized as written, and again without its emoji codes / placeholders (a quote may drop them). */
function haystacks(message: MatchableMessage): string[] {
  const raw = messageHaystack(message)
  const withoutCodes = raw.replace(BRACKET_CODE, '')
  return withoutCodes === raw ? [normalizeForMatch(raw)] : [normalizeForMatch(raw), normalizeForMatch(withoutCodes)]
}

/** Ways a quote may have been written: as is, without emoji codes / placeholders, without a sender prefix. Each is split at elisions. */
function quoteForms(quote: string): string[][] {
  const forms = new Set([quote, quote.replace(BRACKET_CODE, ''), quote.replace(SENDER_PREFIX, '')])
  const out: string[][] = []
  for (const form of forms) {
    const pieces = form
      .split(ELLIPSIS)
      .map(normalizeForMatch)
      .filter((piece) => piece.length > 0)
    if (pieces.length) out.push(pieces)
  }
  return out
}

function containsInOrder(hay: string, pieces: readonly string[]): boolean {
  let from = 0
  for (const piece of pieces) {
    const at = hay.indexOf(piece, from)
    if (at < 0) return false
    from = at + piece.length
  }
  return true
}

/** Whether the quoted words occur in the message. A quote that normalizes to nothing (an emoji) passes. */
export function quoteMatches(quote: string, message: MatchableMessage): boolean {
  const forms = quoteForms(quote)
  if (forms.length === 0) return true
  const hays = haystacks(message)
  return forms.some((pieces) => hays.some((hay) => containsInOrder(hay, pieces)))
}

export type QuoteVerdict = 'verbatim' | 'mismatch' | 'unquoted'

/**
 * Checks the quotes a citation vouches for. A quote passes when it is in the cited message, or in another message of
 * the same citation run (「A」「B」 followed by [b][a]: the pairing slipped, the words are real). 'unquoted' when the
 * citation vouches for no quote.
 */
export function verifyClaim(
  quotes: readonly string[],
  cited: MatchableMessage,
  siblings: readonly MatchableMessage[] = [],
): { verdict: QuoteVerdict; unmatched: string[] } {
  if (quotes.length === 0) return { verdict: 'unquoted', unmatched: [] }
  const unmatched = quotes.filter((q) => !quoteMatches(q, cited) && !siblings.some((m) => quoteMatches(q, m)))
  return { verdict: unmatched.length ? 'mismatch' : 'verbatim', unmatched }
}

/** A piece of one Markdown block in reading order: plain text, or a `wx://` citation link. */
export type CitationToken =
  { kind: 'text'; text: string } | ({ kind: 'cite'; label: string; link: string } & CitationRef)

export interface CitationClaim extends CitationRef {
  /** Link text as written. */
  label: string
  /** The raw link, for quoting back to the model. */
  link: string
  /** The quotes this citation vouches for. */
  quotes: string[]
  /** Every citation written together with this one (itself included), in order. */
  run: CitationRef[]
}

/** Text that keeps two citations in one run: nothing but whitespace and punctuation, a few characters at most. */
const RUN_SEPARATOR = /^[\s\p{P}\p{S}]{0,4}$/u
/**
 * Visible characters allowed between a quote and the citation run it belongs to (or the next quote of the same
 * group): 「原文」——庄曼琦 [cite] still belongs together; a quoted nickname earlier in the sentence does not.
 */
export const QUOTE_ATTACH_GAP = 20

const visibleLength = (text: string): number => [...text.replace(/\s+/g, '')].length

/** The quotes directly before a citation run: the nearest one, and each earlier one close to the next. */
function attachedQuotes(window: string): string[] {
  const spans = quoteSpans(window)
  const out: string[] = []
  let boundary = window.length
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!
    if (visibleLength(window.slice(span.end, boundary)) > QUOTE_ATTACH_GAP) break
    out.unshift(span.text)
    boundary = span.start
  }
  return out
}

/**
 * Pairs the quotes of one block with its citations. Citations written next to each other form a run; the quotes
 * attached to a run are handed out in order (the first quote to the first citation…), the last citation taking any
 * extra quotes. The Agent panel and the host's Stop-hook audit both judge citations through this function.
 */
export function planCitations(tokens: readonly CitationToken[]): CitationClaim[] {
  const claims: CitationClaim[] = []
  let pending = ''
  let window = ''
  let run: Array<Extract<CitationToken, { kind: 'cite' }>> = []
  const closeRun = () => {
    if (run.length === 0) return
    const quotes = attachedQuotes(window)
    const refs = run.map(({ sessionId, messageId }) => ({ sessionId, messageId }))
    run.forEach((cite, i) => {
      const last = i === run.length - 1
      const assigned = last ? quotes.slice(i) : quotes[i] !== undefined ? [quotes[i]] : []
      claims.push({
        sessionId: cite.sessionId,
        messageId: cite.messageId,
        label: cite.label,
        link: cite.link,
        quotes: assigned,
        run: refs,
      })
    })
    run = []
  }
  for (const token of tokens) {
    if (token.kind === 'text') {
      pending += token.text
      continue
    }
    if (run.length > 0 && RUN_SEPARATOR.test(pending)) {
      run.push(token)
      pending = ''
      continue
    }
    closeRun()
    window = pending
    pending = ''
    run = [token]
  }
  closeRun()
  return claims
}

const CITATION_LINK = /\[([^\]]+)\]\((wx:\/\/[^)\s]+)\)/g
const BLOCK_START = /^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/

/** Splits one Markdown block into text and citation tokens. */
function tokenizeBlock(block: string): CitationToken[] {
  const tokens: CitationToken[] = []
  let last = 0
  for (const match of block.matchAll(CITATION_LINK)) {
    const ref = parseCitationHref(match[2]!)
    if (!ref) continue
    const at = match.index ?? 0
    tokens.push({ kind: 'text', text: block.slice(last, at) })
    tokens.push({ kind: 'cite', label: match[1]!, link: match[0], ...ref })
    last = at + match[0].length
  }
  tokens.push({ kind: 'text', text: block.slice(last) })
  return tokens
}

/**
 * Every citation in a Markdown reply with the quotes it vouches for. Blocks (paragraph, list item, heading, quote)
 * are planned separately; fenced code is skipped because it never renders links.
 */
export function findCitationClaims(markdown: string): CitationClaim[] {
  const blocks: string[] = []
  let current: string[] = []
  let fenced = false
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'))
    current = []
  }
  for (const line of markdown.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      flush()
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (!line.trim()) {
      flush()
      continue
    }
    const quoteLine = /^\s{0,3}>/.test(line)
    const previousIsQuote = current.length > 0 && /^\s{0,3}>/.test(current[current.length - 1]!)
    if (BLOCK_START.test(line) && !(quoteLine && previousIsQuote)) flush()
    current.push(line)
  }
  flush()
  return blocks.flatMap((block) => planCitations(tokenizeBlock(block)))
}
