/**
 * Sidebar grouping of the Agent window (pure): pinned threads first, then today / yesterday / last 7 days /
 * earlier by `updatedAt`. Threads arrive already sorted by the store (pinned first, newest first), so the
 * order inside a group is the store's order.
 */
import type { ThreadSummary } from '@aiwc/protocol'
import { dayDiff } from '@/platform/format'
import { isUntitledTitle } from '../model'

export type ThreadGroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'earlier'

export interface ThreadGroup {
  id: ThreadGroupId
  threads: ThreadSummary[]
}

const GROUP_ORDER: readonly ThreadGroupId[] = ['pinned', 'today', 'yesterday', 'week', 'earlier']

export function groupThreads(threads: readonly ThreadSummary[], now: number = Date.now()): ThreadGroup[] {
  const buckets: Record<ThreadGroupId, ThreadSummary[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  }
  for (const thread of threads) {
    if (thread.pinned) {
      buckets.pinned.push(thread)
      continue
    }
    const days = dayDiff(thread.updatedAt, now)
    buckets[days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'earlier'].push(thread)
  }
  return GROUP_ORDER.map((id) => ({ id, threads: buckets[id] })).filter((group) => group.threads.length > 0)
}

/** Case-insensitive match on the shown title (untitled threads match `untitled`) or the context label. */
export function filterThreads(threads: readonly ThreadSummary[], query: string, untitled: string): ThreadSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...threads]
  return threads.filter((thread) => {
    const title = isUntitledTitle(thread.title) ? untitled : thread.title
    return title.toLowerCase().includes(q) || (thread.contextRef?.label.toLowerCase().includes(q) ?? false)
  })
}
