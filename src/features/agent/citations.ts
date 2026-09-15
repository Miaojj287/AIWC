/**
 * Evidence citations in Agent replies. The format and the quote check live in @aiwc/protocol so the
 * panel's chip and the host's Stop-hook audit judge a citation the same way; this file only adds
 * what the chip needs on top.
 */
import { parseCitationHref, type CitationRef } from '@aiwc/protocol'

export { extractQuotes, normalizeForMatch, verifyQuotes, type CitationRef, type QuoteVerdict } from '@aiwc/protocol'

export const parseCitation = (href: string): CitationRef | undefined => parseCitationHref(href)

/** `MM-DD HH:mm` in local time for the chip label. */
export function citationTime(ms: number): string {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
