/**
 * `substrate:search` for the search tab: the first page whenever the search changes, a bigger page for 加载更多 (the
 * substrate ranks by relevance, so there is no cursor to page with), a fresh run for 重试 / Enter. While a new search
 * runs, the previous hits stay on screen, so typing does not blank the list. An answer that arrives after its search
 * was replaced is dropped.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SearchHit } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'
import {
  hasMoreResults,
  MAX_RESULTS,
  nextLimit,
  PAGE_SIZE,
  toSearchQuery,
  type SearchRange,
  type SearchTabState,
} from './searchModel'

interface Answer {
  key: string
  limit: number
  run: number
  hits: readonly SearchHit[]
  error?: Error
}

export interface HistorySearch {
  /** Hits on screen: the current search's, or the previous search's while the current one runs. */
  hits: readonly SearchHit[]
  /** A request for the current search is in flight (first page, a bigger page or a re-run). */
  pending: boolean
  /** The hits answer an earlier search. */
  stale: boolean
  loadingMore: boolean
  /** The current search failed; with hits on screen only 加载更多 did. */
  error: Error | undefined
  /** The page came back full: 加载更多 may find more. */
  hasMore: boolean
  /** The list reached MAX_RESULTS. */
  capped: boolean
  loadMore(): void
  rerun(): void
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

export function useHistorySearch(
  request: Pick<SearchTabState, 'query' | 'sessionIds' | 'range'>,
  enabled: boolean,
): HistorySearch {
  const query = request.query.trim()
  const scope = request.sessionIds.join('\n')
  const preset = request.range.preset
  const from = request.range.preset === 'custom' ? request.range.from : undefined
  const to = request.range.preset === 'custom' ? request.range.to : undefined
  const key = JSON.stringify([query, scope, preset, from ?? null, to ?? null])
  const active = enabled && query !== ''

  // What to fetch for the current search; a new search starts again at the first page.
  const [want, setWant] = useState({ key, limit: PAGE_SIZE, run: 0 })
  const target = want.key === key ? want : { key, limit: PAGE_SIZE, run: 0 }
  const [answer, setAnswer] = useState<Answer | undefined>(undefined)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const range: SearchRange = preset === 'custom' ? { preset, from, to } : { preset }
    const sessionIds = scope ? scope.split('\n') : []
    const stamp = { key, limit: target.limit, run: target.run }
    invoke('substrate:search', toSearchQuery({ query, sessionIds, range }, target.limit, Date.now())).then(
      (hits) => {
        if (!cancelled) setAnswer({ ...stamp, hits })
      },
      (e: unknown) => {
        if (cancelled) return
        // A failed 加载更多 keeps the hits it was extending.
        setAnswer((prev) => ({ ...stamp, hits: prev?.key === key ? prev.hits : [], error: toError(e) }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [active, key, query, scope, preset, from, to, target.limit, target.run])

  const current = answer?.key === key ? answer : undefined
  const settled = active && current !== undefined && current.limit === target.limit && current.run === target.run
  const pending = active && !settled
  const hits = current?.hits ?? (pending ? (answer?.hits ?? []) : [])
  const error = settled ? current.error : undefined

  const { limit, run } = target
  const loadMore = useCallback(() => setWant({ key, limit: nextLimit(limit), run }), [key, limit, run])
  const rerun = useCallback(() => setWant({ key, limit, run: run + 1 }), [key, limit, run])

  return {
    hits: active ? hits : [],
    pending,
    stale: pending && current === undefined && hits.length > 0,
    loadingMore: pending && current !== undefined && current.limit < limit,
    error,
    hasMore: settled && !error && hasMoreResults(hits.length, limit),
    capped: settled && !error && hits.length >= MAX_RESULTS,
    loadMore,
    rerun,
  }
}
