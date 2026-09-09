/**
 * Message window for one chat tab: latest page on mount, older pages while scrolling up, newer pages
 * after a jump, live tail updates from `substrate:event` (messages.changed). Filters are part of the
 * query so changing them reloads the window.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ListMessagesQuery, MessageAnchor, WxMessage } from '@aiwc/protocol'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { toListQuery, type ChatFilters } from './filters'
import { mergeMessages, type MergeMode } from './streamModel'

export const PAGE_SIZE = 60
export const CONTEXT_RADIUS = 30

export type StreamChange = 'init' | MergeMode

export interface MessagesState {
  messages: WxMessage[]
  /** Initial load of a window (spinner in the stream). */
  loading: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  hasOlder: boolean
  hasNewer: boolean
  error: string | undefined
  /** How the last update changed the list — the virtualizer uses it to keep the scroll anchored. */
  lastChange: StreamChange
  /** Message to scroll to after the window loaded (jump target). */
  pendingFocusId: string | undefined
  /** Bumps on every window reset so the stream re-runs its initial scroll. */
  windowKey: number
}

type Action =
  | { type: 'reset' }
  | { type: 'loaded'; messages: WxMessage[]; hasOlder: boolean; hasNewer: boolean; focusId?: string }
  | { type: 'error'; error: string }
  | { type: 'older.start' }
  | { type: 'older.done'; messages: WxMessage[]; hasMore: boolean }
  | { type: 'older.fail' }
  | { type: 'newer.start' }
  | { type: 'newer.done'; messages: WxMessage[]; hasMore: boolean }
  | { type: 'newer.fail' }
  | { type: 'focus.consumed' }

const initial: MessagesState = {
  messages: [],
  loading: true,
  loadingOlder: false,
  loadingNewer: false,
  hasOlder: false,
  hasNewer: false,
  error: undefined,
  lastChange: 'init',
  pendingFocusId: undefined,
  windowKey: 0,
}

function reducer(s: MessagesState, a: Action): MessagesState {
  switch (a.type) {
    case 'reset':
      return { ...initial, windowKey: s.windowKey + 1 }
    case 'loaded':
      return { ...s, loading: false, error: undefined, messages: mergeMessages([], a.messages, 'replace'), hasOlder: a.hasOlder, hasNewer: a.hasNewer, lastChange: 'replace', pendingFocusId: a.focusId, windowKey: s.windowKey + 1 }
    case 'error':
      return { ...s, loading: false, loadingOlder: false, loadingNewer: false, error: a.error }
    case 'older.start':
      return { ...s, loadingOlder: true }
    case 'older.done':
      return { ...s, loadingOlder: false, hasOlder: a.hasMore, messages: mergeMessages(s.messages, a.messages, 'prepend'), lastChange: 'prepend' }
    case 'older.fail':
      return { ...s, loadingOlder: false }
    case 'newer.start':
      return { ...s, loadingNewer: true }
    case 'newer.done':
      return { ...s, loadingNewer: false, hasNewer: a.hasMore, messages: mergeMessages(s.messages, a.messages, 'append'), lastChange: 'append' }
    case 'newer.fail':
      return { ...s, loadingNewer: false }
    case 'focus.consumed':
      return s.pendingFocusId === undefined ? s : { ...s, pendingFocusId: undefined }
    default:
      return s
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface UseMessages extends MessagesState {
  loadOlder(): void
  loadNewer(): void
  /** Replace the window with ±CONTEXT_RADIUS messages around an anchor and focus it. */
  jumpTo(anchor: MessageAnchor): Promise<void>
  /** Back to the live tail (latest page). */
  reload(): void
  consumeFocus(): void
}

export interface UseMessagesOptions {
  /**
   * Consulted whenever the window is (re)loaded because sessionId / filters changed. Returning an anchor
   * jumps to it instead of loading the tail — used by 跳转到时间, which clears the filters first.
   */
  takePendingJump?: () => MessageAnchor | undefined
}

export function useMessages(sessionId: string, filters: ChatFilters, options: UseMessagesOptions = {}): UseMessages {
  const [state, dispatch] = useReducer(reducer, initial)
  const stateRef = useRef(state)
  stateRef.current = state
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const optionsRef = useRef(options)
  optionsRef.current = options
  // Serialises windows: a stale response from a previous window / filters is ignored.
  const epoch = useRef(0)

  const baseQuery = useCallback((limit: number): ListMessagesQuery => toListQuery(sessionId, filtersRef.current, limit), [sessionId])

  const loadLatest = useCallback(async () => {
    const my = ++epoch.current
    dispatch({ type: 'reset' })
    try {
      const res = await invoke('substrate:listMessages', baseQuery(PAGE_SIZE))
      if (my !== epoch.current) return
      dispatch({ type: 'loaded', messages: res.items, hasOlder: res.hasMore, hasNewer: false })
    } catch (e) {
      if (my === epoch.current) dispatch({ type: 'error', error: errText(e) })
    }
  }, [baseQuery])


  const loadOlder = useCallback(() => {
    const s = stateRef.current
    const first = s.messages[0]
    if (!first || !s.hasOlder || s.loadingOlder || s.loading) return
    const my = epoch.current
    dispatch({ type: 'older.start' })
    invoke('substrate:listMessages', { ...baseQuery(PAGE_SIZE), beforeSeq: first.seq })
      .then((res) => {
        if (my !== epoch.current) return
        dispatch({ type: 'older.done', messages: res.items, hasMore: res.hasMore })
      })
      .catch(() => {
        if (my === epoch.current) dispatch({ type: 'older.fail' })
      })
  }, [baseQuery])

  const loadNewer = useCallback(() => {
    const s = stateRef.current
    const last = s.messages[s.messages.length - 1]
    if (!last || !s.hasNewer || s.loadingNewer || s.loading) return
    const my = epoch.current
    dispatch({ type: 'newer.start' })
    invoke('substrate:listMessages', { ...baseQuery(PAGE_SIZE), afterSeq: last.seq })
      .then((res) => {
        if (my !== epoch.current) return
        dispatch({ type: 'newer.done', messages: res.items, hasMore: res.hasMore })
      })
      .catch(() => {
        if (my === epoch.current) dispatch({ type: 'newer.fail' })
      })
  }, [baseQuery])

  const jumpTo = useCallback(
    async (anchor: MessageAnchor) => {
      const my = ++epoch.current
      dispatch({ type: 'reset' })
      try {
        const items = await invoke('substrate:getContext', { anchor, radius: CONTEXT_RADIUS })
        if (my !== epoch.current) return
        if (items.length === 0) {
          dispatch({ type: 'error', error: '没有找到这条消息，它可能不在本地索引中' })
          return
        }
        // Whether more exists on either side is unknown until a page comes back empty.
        dispatch({ type: 'loaded', messages: items, hasOlder: true, hasNewer: true, focusId: items.find((m) => m.id === anchor.messageId)?.id ?? items.find((m) => m.seq === anchor.seq)?.id ?? anchor.messageId })
      } catch (e) {
        if (my === epoch.current) dispatch({ type: 'error', error: errText(e) })
      }
    },
    [],
  )

  // Filters are compared by value so an equal object from tab.state does not reload.
  const filtersKey = JSON.stringify(filters)
  useEffect(() => {
    const anchor = optionsRef.current.takePendingJump?.()
    if (anchor) void jumpTo(anchor)
    else void loadLatest()
    return () => { epoch.current += 1 }
  }, [loadLatest, jumpTo, filtersKey])

  // Drain every page: a single sync notification can contain more than PAGE_SIZE messages.
  const tailRequest = useRef<{ epoch: number; dirty: boolean } | undefined>(undefined)
  useBridgeEvent('substrate:event', (ev) => {
    if (ev.type !== 'messages.changed' || !ev.sessionIds.includes(sessionId)) return
    const s = stateRef.current
    if (s.loading || s.hasNewer) return
    const last = s.messages[s.messages.length - 1]
    if (!last) {
      void loadLatest()
      return
    }
    const my = epoch.current
    if (tailRequest.current?.epoch === my) {
      tailRequest.current.dirty = true
      return
    }
    const request = { epoch: my, dirty: false }
    tailRequest.current = request
    void (async () => {
      let afterSeq = last.seq
      try {
        do {
          request.dirty = false
          const res = await invoke('substrate:listMessages', { ...baseQuery(PAGE_SIZE), afterSeq })
          if (my !== epoch.current) return
          const next = res.items[res.items.length - 1]
          if (res.items.length) dispatch({ type: 'newer.done', messages: res.items, hasMore: false })
          if (next && next.seq > afterSeq) {
            afterSeq = next.seq
            if (res.hasMore) request.dirty = true
          }
        } while (request.dirty)
      } catch { /* A later change notification retries from the visible tail. */ }
      finally {
        if (tailRequest.current === request) tailRequest.current = undefined
      }
    })()
  })

  const consumeFocus = useCallback(() => dispatch({ type: 'focus.consumed' }), [])

  return { ...state, loadOlder, loadNewer, jumpTo, reload: () => void loadLatest(), consumeFocus }
}
