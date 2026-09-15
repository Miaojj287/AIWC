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

/** Pairs of quotation marks a Chinese or English reply may use around verbatim text. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['‘', '’'],
  ['"', '"'],
]

/** Quoted segments in `text`, grouped by quote style; segments shorter than 2 characters are ignored. */
export function extractQuotes(text: string): string[] {
  const out: string[] = []
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0
    for (;;) {
      const start = text.indexOf(open, from)
      if (start < 0) break
      const end = text.indexOf(close, start + open.length)
      if (end < 0) break
      const inner = text.slice(start + open.length, end).trim()
      if ([...inner].length >= 2) out.push(inner)
      from = end + close.length
    }
  }
  return out
}

/** Case-, width- and punctuation-insensitive form used for containment checks. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Everything a message "says": its text plus a voice transcript and the quoted reply, if any. */
export function messageHaystack(message: Pick<WxMessage, 'text' | 'media' | 'quote'>): string {
  return [message.text, message.media?.transcript, message.quote?.text].filter(Boolean).join('\n')
}

/** Quoted segments of `context` that do not occur in the message. */
export function unmatchedQuotes(context: string, message: Pick<WxMessage, 'text' | 'media' | 'quote'>): string[] {
  const hay = normalizeForMatch(messageHaystack(message))
  return extractQuotes(context).filter((q) => {
    const needle = normalizeForMatch(q)
    return needle.length > 0 && !hay.includes(needle)
  })
}

export type QuoteVerdict = 'verbatim' | 'mismatch' | 'unquoted'

/**
 * 'verbatim' when every quoted segment occurs in the message, 'mismatch' when at least one does not,
 * 'unquoted' when the context carried no quotation to check.
 */
export function verifyQuotes(context: string, message: Pick<WxMessage, 'text' | 'media' | 'quote'>): QuoteVerdict {
  if (extractQuotes(context).length === 0) return 'unquoted'
  return unmatchedQuotes(context, message).length === 0 ? 'verbatim' : 'mismatch'
}

export interface CitationClaim extends CitationRef {
  /** Link text as written. */
  label: string
  /** The raw link, for quoting back to the model. */
  link: string
  /** Text written since the previous citation in the same block — the quotes a citation vouches for. */
  context: string
}

const CITATION_LINK = /\[([^\]]+)\]\((wx:\/\/[^)\s]+)\)/g
const BLOCK_START = /^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/

/**
 * Every citation in a Markdown reply with the text it vouches for. Mirrors how the Agent panel scopes a
 * chip's check: context resets at each citation and at every block (paragraph, list item, heading,
 * quote); fenced code is skipped because it never renders links.
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

  const claims: CitationClaim[] = []
  for (const block of blocks) {
    let last = 0
    for (const match of block.matchAll(CITATION_LINK)) {
      const ref = parseCitationHref(match[2]!)
      const at = match.index ?? 0
      if (ref) claims.push({ ...ref, label: match[1]!, link: match[0], context: block.slice(last, at) })
      last = at + match[0].length
    }
  }
  return claims
}
