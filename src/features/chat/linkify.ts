/**
 * Text segmentation for message bubbles: URLs become links, search matches become highlighted marks.
 * Pure; rendering happens in MessageBody.
 */
export interface TextSegment {
  text: string
  href?: string
  mark?: boolean
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'()（）【】，。；！？]+)/gi

function normaliseHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** Split into plain / link segments. Trailing punctuation is kept out of the link. */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    let url = m[0]
    let trail = ''
    while (url.length > 0 && /[.,;:!?]$/.test(url)) {
      trail = url.slice(-1) + trail
      url = url.slice(0, -1)
    }
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ text: url, href: normaliseHref(url) })
    if (trail) out.push({ text: trail })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text }]
}

/** Split one segment around case-insensitive occurrences of `query`, marking the matches. */
function markSegment(seg: TextSegment, query: string): TextSegment[] {
  const q = query.toLowerCase()
  const lower = seg.text.toLowerCase()
  const out: TextSegment[] = []
  let i = 0
  for (let idx = lower.indexOf(q); idx >= 0; idx = lower.indexOf(q, idx + q.length)) {
    if (idx > i) out.push({ ...seg, text: seg.text.slice(i, idx) })
    out.push({ ...seg, text: seg.text.slice(idx, idx + q.length), mark: true })
    i = idx + q.length
  }
  if (i < seg.text.length) out.push({ ...seg, text: seg.text.slice(i) })
  return out.length ? out : [seg]
}

/** Links + highlight in one pass. Empty query = links only. */
export function segmentText(text: string, query?: string): TextSegment[] {
  const linked = splitLinks(text)
  const q = query?.trim()
  if (!q) return linked
  return linked.flatMap((seg) => markSegment(seg, q))
}
