/**
 * Searching the Agent's own conversations (agent:searchThreads): one hit per thread, the newest matching message,
 * with the matched words wrapped in THREAD_SEARCH_MARKS so the renderer can highlight them without parsing markup.
 */
import type { ThreadId } from './ids'

/** Private-use characters around each match in a snippet; never typed by a user, never part of a message. */
export const THREAD_SEARCH_MARKS = ['', ''] as const

export interface ThreadSearchHit {
  threadId: ThreadId
  /** Thread title as shown in the history (the first prompt when the stored title is empty). */
  title: string
  /** The matching history item (user prompt or agent reply). */
  itemId: string
  /** One line around the match, matches wrapped in THREAD_SEARCH_MARKS, citation links reduced to their labels. */
  snippet: string
  ts: number
}

/** Snippet → runs of plain and matched text, for rendering. */
export function splitSearchSnippet(snippet: string): Array<{ text: string; match: boolean }> {
  const [open, close] = THREAD_SEARCH_MARKS
  const out: Array<{ text: string; match: boolean }> = []
  let rest = snippet
  while (rest) {
    const start = rest.indexOf(open)
    if (start < 0) break
    const end = rest.indexOf(close, start + 1)
    if (end < 0) break
    if (start > 0) out.push({ text: rest.slice(0, start), match: false })
    if (end > start + 1) out.push({ text: rest.slice(start + 1, end), match: true })
    rest = rest.slice(end + 1)
  }
  const tail = rest.replaceAll(open, '').replaceAll(close, '')
  if (tail) out.push({ text: tail, match: false })
  return out
}
