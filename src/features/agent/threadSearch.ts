/**
 * Searching the Agent's conversations, shared by the panel's history popover and the Agent window sidebar (CLAUDE.md
 * §12): titles of the loaded threads match at once, and agent:searchThreads finds the words inside every desktop
 * conversation on this computer (not only the loaded page), one hit per thread with a snippet. Choosing a hit opens
 * the thread at that turn (agentStore.revealItem).
 */
import { useEffect, useRef, useState } from 'react'
import type { ThreadSearchHit, ThreadSummary } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'
import { errorMessage } from './agentStoreSupport'

/** Typing pause before the content search runs. */
export const THREAD_SEARCH_DEBOUNCE_MS = 200
/** Conversations a content search returns. */
export const THREAD_SEARCH_LIMIT = 20

export interface ThreadSearchState {
  /** A query is typed: the surfaces show title and content matches instead of the history. */
  active: boolean
  hits: ThreadSearchHit[]
  loading: boolean
  error?: string
}

const IDLE: ThreadSearchState = { active: false, hits: [], loading: false }

export function useThreadSearch(query: string): ThreadSearchState {
  const q = query.trim()
  const [state, setState] = useState<ThreadSearchState>(IDLE)
  // Each run gets a serial; a slower answer to an older query never replaces a newer one.
  const serial = useRef(0)
  useEffect(() => {
    const run = ++serial.current
    if (!q) {
      setState(IDLE)
      return
    }
    setState((s) => ({ active: true, hits: s.active ? s.hits : [], loading: true }))
    const timer = setTimeout(() => {
      invoke('agent:searchThreads', { query: q, limit: THREAD_SEARCH_LIMIT })
        .then((hits) => {
          if (run === serial.current) setState({ active: true, hits, loading: false })
        })
        .catch((e: unknown) => {
          if (run === serial.current) setState({ active: true, hits: [], loading: false, error: errorMessage(e) })
        })
    }, THREAD_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q])
  return state
}

/** Content hits of threads that are not already listed as title matches. */
export function contentOnlyHits(
  hits: readonly ThreadSearchHit[],
  titleMatches: readonly ThreadSummary[],
): ThreadSearchHit[] {
  const listed = new Set(titleMatches.map((t) => t.threadId))
  return hits.filter((h) => !listed.has(h.threadId))
}
