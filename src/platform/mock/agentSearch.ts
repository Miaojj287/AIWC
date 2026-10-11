/**
 * agent:searchThreads for the mock bridge (dev previews, tests): a plain substring search over the canned threads'
 * prompts and replies, shaped like the real handler — newest hit per thread, matches wrapped in THREAD_SEARCH_MARKS.
 */
import { THREAD_SEARCH_MARKS, type HistoryItem, type ThreadSearchHit, type ThreadSummary } from '@aiwc/protocol'

const SNIPPET_RADIUS = 24

function snippetAround(text: string, at: number, length: number): string {
  const [open, close] = THREAD_SEARCH_MARKS
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, at)}${open}${text.slice(at, at + length)}${close}${text.slice(at + length, end)}${end < text.length ? '…' : ''}`.replace(
    /\s+/g,
    ' ',
  )
}

export function mockSearchThreads(
  records: ReadonlyArray<{ summary: ThreadSummary; items: HistoryItem[] }>,
  query: string,
  limit = 20,
): ThreadSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: ThreadSearchHit[] = []
  for (const { summary, items } of records) {
    if (summary.origin.channel !== 'desktop') continue
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      const text =
        item?.type === 'user_message'
          ? item.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ')
          : item?.type === 'assistant_message'
            ? item.text
            : ''
      const at = text.toLowerCase().indexOf(needle)
      if (!item || at < 0) continue
      hits.push({
        threadId: summary.threadId,
        title: summary.title,
        itemId: item.id,
        snippet: snippetAround(text, at, needle.length),
        ts: item.createdAt,
      })
      break
    }
  }
  return hits.sort((a, b) => b.ts - a.ts).slice(0, limit)
}
