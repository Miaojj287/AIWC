/**
 * Test double for the auto-reply lists: the web mock bridge, but serving a caller-supplied chat list
 * page by page (substrate:listSessions with offset / limit / query / hasMore, substrate:getSession)
 * and a fixed rule set. Tests only — never imported by production code.
 */
import type { AutoReplyRule, ListSessionsQuery, WxSession } from '@aiwc/protocol'
import { createMockBridge, type MockBridge } from '@/platform/mockBridge'

/** A direct chat `Chat {i}` (id `wxid_{i}`); later ids are older. */
export function chat(i: number, patch: Partial<WxSession> = {}): WxSession {
  return {
    id: `wxid_${i}`,
    kind: 'dm',
    title: `Chat ${i}`,
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageAt: 1_000_000 - i,
    ...patch,
  }
}

export interface SessionsBridge {
  bridge: MockBridge
  /** Every substrate:listSessions request, in order. */
  requests: ListSessionsQuery[]
}

export function createSessionsBridge(sessions: readonly WxSession[], rules: readonly AutoReplyRule[]): SessionsBridge {
  const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  const requests: ListSessionsQuery[] = []
  bridge.handlers['substrate:listSessions'] = (q) => {
    requests.push(q)
    const needle = q.query?.trim().toLowerCase()
    const matched = sessions.filter(
      (s) =>
        (q.kind === undefined || q.kind === 'all' || s.kind === q.kind) &&
        (!needle || s.title.toLowerCase().includes(needle)),
    )
    const offset = q.offset ?? 0
    const items = matched.slice(offset, offset + q.limit)
    return { items, total: matched.length, hasMore: offset + items.length < matched.length }
  }
  bridge.handlers['substrate:getSession'] = ({ id }) => sessions.find((s) => s.id === id)
  bridge.handlers['autoreply:listRules'] = () => [...rules]
  return { bridge, requests }
}
