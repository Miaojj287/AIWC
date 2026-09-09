/**
 * session.db → WxSession[]. The session table name varies (SessionTable / Session / session), and
 * we SELECT * because explicit column lists break on older schemas.
 */
import type { WxSession } from '@aiwc/protocol'
import { classifySessionKind, shouldKeepSession } from './accountUtils'
import type { ContactDirectory } from './contactQueries'
import { processSummary } from './contentParsers'
import { coerceRowNumber, coerceRowString, getRowField, type Row } from './rowDecoders'
import { quoteIdent, type WcdbQuery } from './query'

const SESSION_TABLE_NAMES = ['SessionTable', 'Session', 'session']
const PAGE = 500

export function resolveSessionTable(q: WcdbQuery, sessionDbPath: string): string | null {
  const names = q.tables(sessionDbPath)
  for (const candidate of SESSION_TABLE_NAMES) {
    const hit = names.find((n) => n === candidate) ?? names.find((n) => n.toLowerCase() === candidate.toLowerCase())
    if (hit) return hit
  }
  return null
}

export function sessionRowUsername(row: Row): string {
  return coerceRowString(getRowField(row, ['username', 'user_name', 'userName'])) ?? ''
}

export function sessionRowSortTimestamp(row: Row): number {
  return coerceRowNumber(getRowField(row, ['sort_timestamp', 'sortTimestamp']), 0)
}

/** Convert to protocol WxSession; returns null for sessions we do not surface. */
export function rowToWxSession(row: Row, contacts: ContactDirectory | null, memberCounts: ReadonlyMap<string, number>): WxSession | null {
  const username = sessionRowUsername(row)
  if (!shouldKeepSession(username)) return null
  const sortTs = sessionRowSortTimestamp(row)
  const lastTs = coerceRowNumber(getRowField(row, ['last_timestamp', 'lastTimestamp']), sortTs)
  const lastMsgType = coerceRowNumber(getRowField(row, ['last_msg_type', 'lastMsgType']), 0)
  const record = contacts?.get(username)
  const kind = record?.kind === 'official' ? 'official' : classifySessionKind(username)
  const mutedRaw = getRowField(row, ['is_muted', 'mute', 'muted'])
  const session: WxSession = {
    id: username,
    kind,
    title: record?.displayName ?? username,
    avatarPath: contacts?.avatar(username),
    lastMessageAt: lastTs > 0 ? lastTs * 1000 : undefined,
    lastPreview: processSummary(getRowField(row, ['summary', 'digest']), lastMsgType || 1),
    lastSender: coerceRowString(getRowField(row, ['last_sender_display_name', 'last_msg_sender', 'lastMsgSender'])),
    unread: Math.max(0, coerceRowNumber(getRowField(row, ['unread_count', 'unreadCount']), 0)),
    pinned: contacts?.isPinned(username) ?? false,
    muted: coerceRowNumber(mutedRaw, 0) === 1,
    collapsed: kind === 'group' && ((record?.flag ?? 0) & 0x10000000) !== 0,
  }
  if (kind === 'group') {
    const count = memberCounts.get(username)
    if (count !== undefined) session.memberCount = count
  }
  return session
}

export interface SessionQueryContext {
  q: WcdbQuery
  sessionDbPath: string
  contacts: ContactDirectory | null
}

/** All sessions ordered by sort_timestamp desc, paged internally. */
export async function querySessions(
  ctx: SessionQueryContext,
  yieldEvery: () => Promise<void>,
  onPage?: (sessions: readonly WxSession[]) => void,
): Promise<WxSession[]> {
  const table = resolveSessionTable(ctx.q, ctx.sessionDbPath)
  if (!table) throw new Error('未找到会话表（SessionTable）')
  // Member counts are not needed for the list and scanning the complete membership table delays
  // first paint. The real group avatar comes from contact.db; members load when a chat is opened.
  const memberCounts = new Map<string, number>()
  const sessions: WxSession[] = []
  let offset = 0
  for (;;) {
    const rows = ctx.q.all(ctx.sessionDbPath, `SELECT * FROM ${quoteIdent(table)} ORDER BY sort_timestamp DESC LIMIT ${PAGE} OFFSET ?`, [offset])
    ctx.contacts?.preload(rows.map(sessionRowUsername))
    const page: WxSession[] = []
    for (const row of rows) {
      const session = rowToWxSession(row, ctx.contacts, memberCounts)
      if (session) {
        sessions.push(session)
        page.push(session)
      }
    }
    if (page.length) onPage?.(page)
    if (rows.length < PAGE) break
    offset += PAGE
    await yieldEvery()
  }
  return sessions
}

/** username → last activity (ms), used to sort contacts by recency. */
export function querySessionActivity(q: WcdbQuery, sessionDbPath: string): Map<string, number> {
  const result = new Map<string, number>()
  const table = resolveSessionTable(q, sessionDbPath)
  if (!table) return result
  const rows = q.all(sessionDbPath, `SELECT * FROM ${quoteIdent(table)}`)
  for (const row of rows) {
    const username = sessionRowUsername(row)
    const ts = sessionRowSortTimestamp(row)
    if (username && ts > 0) result.set(username, ts * 1000)
  }
  return result
}

/** Sessions whose sort_timestamp advanced past `sinceSeconds` (change notifications). */
export function querySessionsChangedSince(q: WcdbQuery, sessionDbPath: string, sinceSeconds: number): { ids: string[]; maxSortTimestamp: number } {
  const table = resolveSessionTable(q, sessionDbPath)
  if (!table) return { ids: [], maxSortTimestamp: sinceSeconds }
  const rows = q.all(sessionDbPath, `SELECT * FROM ${quoteIdent(table)} WHERE sort_timestamp > ? ORDER BY sort_timestamp DESC LIMIT 200`, [sinceSeconds])
  let max = sinceSeconds
  const ids: string[] = []
  for (const row of rows) {
    const username = sessionRowUsername(row)
    max = Math.max(max, sessionRowSortTimestamp(row))
    if (username && shouldKeepSession(username)) ids.push(username)
  }
  return { ids, maxSortTimestamp: max }
}
