/**
 * agent:searchThreads: the rollout index returns one row per matching message; the history shows one row per
 * conversation, so keep each thread's newest hit. Snippets are cut from the agent's replies, which carry citation
 * links (`[02-14 19:28](wx://…)`): reduce those to their labels so the row reads as text.
 */
import type { ThreadSearchHit } from '@aiwc/protocol'
import type { RolloutSearchHit } from '@aiwc/kernel'

/** Conversations one search returns. */
export const THREAD_SEARCH_DEFAULT_LIMIT = 20
export const THREAD_SEARCH_MAX_LIMIT = 50
/** Rows asked of the index per conversation returned (one conversation often matches many times). */
export const ROWS_PER_THREAD = 5
/** Longest query accepted (the search box is one line). */
export const THREAD_SEARCH_MAX_QUERY = 200

const LINK = /\[([^\]\n]*)\]\((?:wx|https?):\/\/[^)\s]*\)/g
const LINK_TAIL = /\]\((?:wx|https?):\/\/[^)\s]*\)?/g
const LINK_HEAD = /\[([^\]\n]*)\]\((?:wx|https?):\/\/[^)\s]*$/
const BARE_URL = /(?:wx|https?):\/\/\S+/g

/** One readable line: links reduced to their labels (a cut-off link dropped), whitespace collapsed. */
export function cleanSnippet(snippet: string): string {
  return snippet
    .replace(LINK, '$1')
    .replace(LINK_HEAD, '$1')
    .replace(LINK_TAIL, '')
    .replace(BARE_URL, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchQuery(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, THREAD_SEARCH_MAX_QUERY) : ''
}

export function searchLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : THREAD_SEARCH_DEFAULT_LIMIT
  return Math.max(1, Math.min(THREAD_SEARCH_MAX_LIMIT, n))
}

/** Newest hit per thread, in the index's (newest-first) order, at most `max` threads. */
export function groupThreadHits(hits: readonly RolloutSearchHit[], max: number): ThreadSearchHit[] {
  const out: ThreadSearchHit[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    if (seen.has(hit.threadId)) continue
    seen.add(hit.threadId)
    out.push({
      threadId: hit.threadId,
      title: hit.title,
      itemId: hit.itemId,
      snippet: cleanSnippet(hit.snippet),
      ts: hit.ts,
    })
    if (out.length >= max) break
  }
  return out
}
