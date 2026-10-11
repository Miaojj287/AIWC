/**
 * Unread WeChat messages across chats, for ambient readouts (the Agent pet). One shared store fed by
 * substrate:listSessions (unread chats only) and refreshed on the substrate's own change events, so any number of
 * readers cost one request per change. Counts follow WeChat's own badge: muted chats, folded chats and official
 * accounts do not add to it.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { WxSession } from '@aiwc/protocol'
import { getBridge } from './bridge'
import { invoke } from './hooks'

/** Chats fetched per refresh; beyond this the total is a lower bound (`capped`). */
const UNREAD_SCAN_LIMIT = 200
/** Sync bursts emit many sessions.changed events; refresh once they settle. */
const REFRESH_DEBOUNCE_MS = 400

export interface WechatUnread {
  /** Unread messages in the chats that count. */
  messages: number
  /** Chats with unread messages that count. */
  chats: number
  /** More unread chats exist than were scanned: `messages` is at least this many. */
  capped: boolean
}

/** Whether a chat adds to the unread total — the chats WeChat's own badge counts. Pure (tested). */
export function countsTowardUnread(
  session: Pick<WxSession, 'id' | 'kind' | 'muted' | 'collapsed' | 'unread'>,
): boolean {
  if (session.unread <= 0 || session.muted || session.collapsed) return false
  if (session.kind === 'official' || session.kind === 'system') return false
  return !session.id.startsWith('gh_')
}

/** Sum a page of unread chats. Pure (tested). */
export function summarizeUnread(sessions: readonly WxSession[], hasMore: boolean): WechatUnread {
  let messages = 0
  let chats = 0
  for (const session of sessions) {
    if (!countsTowardUnread(session)) continue
    messages += session.unread
    chats += 1
  }
  return { messages, chats, capped: hasMore }
}

interface UnreadState {
  /** Undefined until the first answer, and again while the substrate cannot answer (not connected). */
  summary: WechatUnread | undefined
}

export const useWechatUnreadStore = create<UnreadState>(() => ({ summary: undefined }))

let readers = 0
let off: (() => void) | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

function refresh(): void {
  const mine = ++seq
  invoke('substrate:listSessions', { kind: 'all', unreadOnly: true, offset: 0, limit: UNREAD_SCAN_LIMIT })
    .then((res) => {
      if (mine === seq) useWechatUnreadStore.setState({ summary: summarizeUnread(res.items, res.hasMore) })
    })
    .catch(() => {
      // Not connected yet (no account / key): an unknown count shows nothing rather than a misleading 0.
      if (mine === seq) useWechatUnreadStore.setState({ summary: undefined })
    })
}

function scheduleRefresh(): void {
  clearTimeout(timer)
  timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
}

function start(): void {
  refresh()
  let disposed = false
  let unsubscribe: (() => void) | undefined
  getBridge()
    .then((bridge) => {
      if (disposed) return
      unsubscribe = bridge.on('substrate:event', (event) => {
        if (event.type === 'connection' || event.type === 'sessions.changed') scheduleRefresh()
      })
    })
    .catch(() => {
      // No bridge means bootstrap already rendered its fatal error; there is nothing to listen to.
    })
  off = () => {
    disposed = true
    unsubscribe?.()
    clearTimeout(timer)
  }
}

/** Unread WeChat messages, kept live while any reader with `enabled` is mounted; undefined while unknown. */
export function useWechatUnread(enabled = true): WechatUnread | undefined {
  useEffect(() => {
    if (!enabled) return
    readers += 1
    if (readers === 1) start()
    return () => {
      readers -= 1
      if (readers > 0) return
      off?.()
      off = undefined
    }
  }, [enabled])
  const summary = useWechatUnreadStore((s) => s.summary)
  return enabled ? summary : undefined
}

/** Reset module state (tests). */
export function __resetWechatUnreadForTests(): void {
  off?.()
  off = undefined
  readers = 0
  seq += 1
  useWechatUnreadStore.setState({ summary: undefined })
}
