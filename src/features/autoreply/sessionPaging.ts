/**
 * Chats for the auto-reply list and the copy-rule dialog, without a size cap: the paging of the chat
 * list (src/shell/objectList/SessionList.tsx) — first page at once, the next page on demand, search
 * on the backend, stale pages dropped when the query changes — plus the chats behind known rules,
 * resolved one by one so paging can never hide a rule.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WxSession } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'

/** Same page size as the chat list. */
const PAGE_SIZE = 60

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

interface PageState {
  items: WxSession[]
  /** Rows fetched so far (before de-duplication) — the next page's offset. */
  offset: number
  hasMore: boolean
  /** The first page is in flight and there is nothing to show yet. */
  loading: boolean
  loadingMore: boolean
  error: Error | undefined
}

const INITIAL: PageState = { items: [], offset: 0, hasMore: false, loading: true, loadingMore: false, error: undefined }

export interface PagedSessions extends Omit<PageState, 'offset'> {
  /** Fetch the next page when there is one; a no-op while a request is in flight or after an error. */
  loadMore: () => void
  /** Refetch from the top, keeping as many rows as are loaded (a live refresh must not collapse the list). */
  reload: () => void
}

/** substrate:listSessions page by page for `query` (searched by the substrate); idle while `enabled` is false. */
export function usePagedSessions(query: string, enabled = true): PagedSessions {
  const [state, setState] = useState<PageState>(INITIAL)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  /** Bumped by every first-page request; responses of an older sequence are dropped. */
  const seqRef = useRef(0)
  const moreInflight = useRef(false)
  const search = query.trim() || undefined
  const lastSearch = useRef(search)

  useEffect(() => {
    if (!enabled) return
    const seq = ++seqRef.current
    moreInflight.current = false
    // A refresh of the same search keeps the loaded window; a new search starts over at one page.
    const sameSearch = lastSearch.current === search
    lastSearch.current = search
    const limit = sameSearch ? Math.max(PAGE_SIZE, stateRef.current.offset) : PAGE_SIZE
    setState((s) => ({ ...s, loading: s.items.length === 0, loadingMore: false, error: undefined }))
    invoke('substrate:listSessions', { kind: 'all', query: search, offset: 0, limit })
      .then((res) => {
        if (seq !== seqRef.current) return
        setState({
          items: dedupe(res.items),
          offset: res.items.length,
          hasMore: res.hasMore,
          loading: false,
          loadingMore: false,
          error: undefined,
        })
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return
        setState((s) => ({ ...s, loading: false, loadingMore: false, error: toError(e) }))
      })
  }, [enabled, search, tick])

  const loadMore = useCallback(() => {
    const current = stateRef.current
    if (!enabled || !current.hasMore || current.loading || current.error || moreInflight.current) return
    moreInflight.current = true
    const seq = seqRef.current
    setState((s) => ({ ...s, loadingMore: true }))
    invoke('substrate:listSessions', { kind: 'all', query: search, offset: current.offset, limit: PAGE_SIZE })
      .then((res) => {
        if (seq !== seqRef.current) return
        moreInflight.current = false
        setState((s) => ({
          ...s,
          items: dedupe([...s.items, ...res.items]),
          offset: s.offset + res.items.length,
          hasMore: res.hasMore && res.items.length > 0,
          loadingMore: false,
        }))
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return
        moreInflight.current = false
        setState((s) => ({ ...s, loadingMore: false, error: toError(e) }))
      })
  }, [enabled, search])

  return {
    items: state.items,
    hasMore: state.hasMore,
    loading: enabled && state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMore,
    reload,
  }
}

const NO_SESSIONS: ReadonlyMap<string, WxSession> = new Map()

export interface SessionsById {
  sessions: ReadonlyMap<string, WxSession>
  /** Nothing has been resolved yet. */
  loading: boolean
  error: Error | undefined
}

/**
 * The chats behind `ids` (substrate:getSession each), refetched when the id set or `refreshKey`
 * changes; idle until `enabled` (e.g. until the ids themselves are known). Unknown ids (another
 * account's chat, not synced yet) are simply absent from the map.
 */
export function useSessionsById(ids: readonly string[], refreshKey: number, enabled = true): SessionsById {
  const key = [...new Set(ids)].sort().join('\n')
  const [result, setResult] = useState<{ sessions: Map<string, WxSession>; error: Error | undefined } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const wanted = key ? key.split('\n') : []
    Promise.all(wanted.map((id) => invoke('substrate:getSession', { id })))
      .then((found) => {
        if (cancelled) return
        const sessions = new Map<string, WxSession>()
        for (const s of found) if (s) sessions.set(s.id, s)
        setResult({ sessions, error: undefined })
      })
      .catch((e: unknown) => {
        if (!cancelled) setResult((prev) => ({ sessions: prev?.sessions ?? new Map(), error: toError(e) }))
      })
    return () => {
      cancelled = true
    }
  }, [enabled, key, refreshKey])

  return { sessions: result?.sessions ?? NO_SESSIONS, loading: result === null, error: result?.error }
}

function dedupe(items: readonly WxSession[]): WxSession[] {
  const seen = new Set<string>()
  return items.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}
