/**
 * In-memory SubstrateService for tool tests. Deterministic, no I/O. Records every call so tests can
 * assert on the exact query a tool forwarded. Optional members (transcribeVoice / querySql) are
 * only present when the corresponding handler is supplied — mirroring real substrates.
 */
import type {
  ListMessagesQuery,
  ListSessionsQuery,
  MessageAnchor,
  PageRequest,
  SearchHit,
  SearchQuery,
  StatsQuery,
  StatsResult,
  SubstrateEvent,
  SubstrateService,
  SyncStatus,
  WxAccount,
  WxContact,
  WxMedia,
  WxMessage,
  WxSession,
} from '@aiwc/protocol'

export interface FakeSubstrateData {
  account?: WxAccount
  sessions?: WxSession[]
  contacts?: WxContact[]
  messages?: WxMessage[]
  groupMembers?: Record<string, WxContact[]>
  sync?: Partial<SyncStatus>
  transcribe?: (sessionId: string, messageId: string, opts?: { force?: boolean }) => Promise<string>
  querySql?: (req: { db: 'message' | 'contact' | 'session'; sql: string; limit?: number }) => Promise<{ columns: string[]; rows: unknown[][] }>
}

export interface RecordedCall {
  method: string
  args: unknown[]
}

export type FakeSubstrate = SubstrateService & { calls: RecordedCall[]; data: Required<Pick<FakeSubstrateData, 'sessions' | 'contacts' | 'messages' | 'groupMembers'>> }

const contains = (hay: string | undefined, needle: string) => (hay ?? '').toLowerCase().includes(needle.toLowerCase())

function page<T>(items: T[], q: PageRequest | undefined, fallbackLimit = 50): { slice: T[]; hasMore: boolean } {
  const offset = q?.offset ?? 0
  const limit = q?.limit ?? fallbackLimit
  const slice = items.slice(offset, offset + limit)
  return { slice, hasMore: offset + limit < items.length }
}

export function createFakeSubstrate(init: FakeSubstrateData = {}): FakeSubstrate {
  const data = {
    sessions: [...(init.sessions ?? [])],
    contacts: [...(init.contacts ?? [])],
    messages: [...(init.messages ?? [])],
    groupMembers: { ...(init.groupMembers ?? {}) },
  }
  const calls: RecordedCall[] = []
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })
  const sync: SyncStatus = { phase: 'idle', lastSyncedAt: 1_700_000_000_000, totals: { sessions: data.sessions.length, messages: data.messages.length, media: 0 }, ...(init.sync ?? {}) }

  const messagesOf = (sessionId: string) => data.messages.filter((m) => m.sessionId === sessionId).sort((a, b) => a.seq - b.seq)

  const service: SubstrateService = {
    status: () => ({ connection: 'ready', sync, ...(init.account ? { account: init.account } : {}) }),
    listAccounts: async () => (init.account ? [init.account] : []),
    getAccount: async () => init.account,

    async listSessions(q: ListSessionsQuery) {
      record('listSessions', q)
      let items = [...data.sessions]
      if (q.kind && q.kind !== 'all') items = items.filter((s) => s.kind === q.kind)
      if (q.query) items = items.filter((s) => contains(s.title, q.query!))
      if (q.unreadOnly) items = items.filter((s) => s.unread > 0)
      items.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      const { slice, hasMore } = page(items, q)
      return { items: slice, total: items.length, hasMore }
    },
    async getSession(id: string) {
      record('getSession', id)
      return data.sessions.find((s) => s.id === id)
    },

    async listMessages(q: ListMessagesQuery) {
      record('listMessages', q)
      let items = messagesOf(q.sessionId)
      if (q.from !== undefined) items = items.filter((m) => m.createdAt >= q.from!)
      if (q.to !== undefined) items = items.filter((m) => m.createdAt <= q.to!)
      if (q.kinds && q.kinds.length > 0) items = items.filter((m) => q.kinds!.includes(m.kind))
      if (q.senderIds && q.senderIds.length > 0) items = items.filter((m) => q.senderIds!.includes(m.senderId))
      if (q.afterSeq !== undefined) {
        const after = items.filter((m) => m.seq > q.afterSeq!)
        return { items: after.slice(0, q.limit), hasMore: after.length > q.limit }
      }
      if (q.beforeSeq !== undefined) items = items.filter((m) => m.seq < q.beforeSeq!)
      // default / backwards: latest `limit`, returned newest-first to exercise the tools' sorting
      const tail = items.slice(Math.max(0, items.length - q.limit))
      return { items: tail.reverse(), hasMore: items.length > q.limit }
    },
    async getMessage(sessionId: string, messageId: string) {
      record('getMessage', sessionId, messageId)
      return data.messages.find((m) => m.sessionId === sessionId && m.id === messageId)
    },
    async getContext(anchor: MessageAnchor, radius: number) {
      record('getContext', anchor, radius)
      const items = messagesOf(anchor.sessionId)
      const idx = items.findIndex((m) => m.id === anchor.messageId)
      if (idx < 0) return []
      return items.slice(Math.max(0, idx - radius), idx + radius + 1)
    },

    async search(q: SearchQuery) {
      record('search', q)
      const terms = q.query.toLowerCase().split(/\s+/).filter(Boolean)
      let items = [...data.messages]
      if (q.sessionIds && q.sessionIds.length > 0) items = items.filter((m) => q.sessionIds!.includes(m.sessionId))
      if (q.from !== undefined) items = items.filter((m) => m.createdAt >= q.from!)
      if (q.to !== undefined) items = items.filter((m) => m.createdAt <= q.to!)
      const source: SearchHit['source'] = q.mode === 'hybrid' ? 'fused' : q.mode === 'semantic' ? 'vector' : 'fts'
      const hits: SearchHit[] = []
      for (const m of items) {
        const hay = `${m.text} ${m.media?.transcript ?? ''}`.toLowerCase()
        const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
        if (score > 0) hits.push({ message: m, score, snippet: m.text, source })
      }
      hits.sort((a, b) => b.score - a.score || b.message.createdAt - a.message.createdAt)
      return hits.slice(0, q.limit)
    },

    async listContacts(q) {
      record('listContacts', q)
      let items = [...data.contacts]
      if (q.kind && q.kind !== 'all') items = items.filter((c) => c.kind === q.kind)
      if (q.query) {
        const needle = q.query
        items = items.filter((c) => contains(c.nickname, needle) || contains(c.remark, needle) || contains(c.alias, needle) || contains(c.username, needle))
      }
      const { slice } = page(items, q)
      return { items: slice, total: items.length }
    },
    async getContact(username: string) {
      record('getContact', username)
      return data.contacts.find((c) => c.username === username)
    },
    async listGroupMembers(groupId: string, q?: PageRequest) {
      record('listGroupMembers', groupId, q)
      const all = data.groupMembers[groupId] ?? []
      const { slice } = page(all, q, all.length)
      return { items: slice, total: all.length }
    },

    async stats(q: StatsQuery): Promise<StatsResult> {
      record('stats', q)
      let items = q.sessionId ? messagesOf(q.sessionId) : [...data.messages]
      if (q.from !== undefined) items = items.filter((m) => m.createdAt >= q.from!)
      if (q.to !== undefined) items = items.filter((m) => m.createdAt <= q.to!)
      if (q.metric === 'overview') {
        const byKind: Record<string, number> = {}
        for (const m of items) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
        return { metric: 'overview', rows: [{ total: items.length, sent: items.filter((m) => m.isSelf).length, received: items.filter((m) => !m.isSelf).length, ...byKind }], total: items.length }
      }
      if (q.metric === 'ranking') {
        const counts = new Map<string, { name: string; count: number }>()
        for (const m of items) {
          const key = q.sessionId ? m.senderId : m.sessionId
          const cur = counts.get(key) ?? { name: q.sessionId ? m.senderName ?? m.senderId : m.sessionId, count: 0 }
          cur.count += 1
          counts.set(key, cur)
        }
        const rows = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).map(([id, v]) => ({ id, name: v.name, messageCount: v.count }))
        return { metric: 'ranking', rows: rows.slice(0, q.limit ?? rows.length), total: rows.length }
      }
      const buckets = new Map<string, number>()
      for (const m of items) {
        const d = new Date(m.createdAt)
        const key = q.groupBy === 'weekday' ? String(d.getDay()) : q.groupBy === 'day' ? d.toISOString().slice(0, 10) : q.groupBy === 'month' ? d.toISOString().slice(0, 7) : String(d.getHours())
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      return { metric: 'time_distribution', rows: [...buckets.entries()].map(([bucket, count]) => ({ bucket, count })), total: items.length }
    },

    async resolveMedia(sessionId: string, messageId: string): Promise<WxMedia | undefined> {
      record('resolveMedia', sessionId, messageId)
      return data.messages.find((m) => m.sessionId === sessionId && m.id === messageId)?.media
    },
    async sync() {
      record('sync')
      return sync
    },
    subscribe(_listener: (event: SubstrateEvent) => void) {
      return () => {}
    },
  }

  if (init.transcribe) {
    const fn = init.transcribe
    service.transcribeVoice = async (sessionId, messageId, opts) => {
      record('transcribeVoice', sessionId, messageId, opts)
      return fn(sessionId, messageId, opts)
    }
  }
  if (init.querySql) {
    const fn = init.querySql
    service.querySql = async (req) => {
      record('querySql', req)
      return fn(req)
    }
  }

  return Object.assign(service, { calls, data })
}

// ---------------------------------------------------------------------------------------------
// Fixture builders (no real WeChat data; ids are obviously synthetic)
// ---------------------------------------------------------------------------------------------

export const T0 = Date.UTC(2026, 0, 10, 4, 0, 0) // 2026-01-10 04:00Z

export function msg(partial: Partial<WxMessage> & Pick<WxMessage, 'id' | 'sessionId' | 'seq'>): WxMessage {
  const createdAt = partial.createdAt ?? T0 + partial.seq * 60_000
  const base: WxMessage = {
    id: partial.id,
    sessionId: partial.sessionId,
    seq: partial.seq,
    createdAt,
    senderId: partial.senderId ?? 'user_a',
    isSelf: partial.isSelf ?? false,
    kind: partial.kind ?? 'text',
    text: partial.text ?? '',
    anchor: { sessionId: partial.sessionId, messageId: partial.id, seq: partial.seq, createdAt },
  }
  if (partial.senderName !== undefined) base.senderName = partial.senderName
  if (partial.media) base.media = partial.media
  if (partial.quote) base.quote = partial.quote
  return base
}

export function session(partial: Partial<WxSession> & Pick<WxSession, 'id' | 'title'>): WxSession {
  return { kind: partial.id.endsWith('@chatroom') ? 'group' : 'dm', unread: 0, pinned: false, muted: false, ...partial }
}

export function contact(partial: Partial<WxContact> & Pick<WxContact, 'username' | 'nickname'>): WxContact {
  return { kind: partial.username.endsWith('@chatroom') ? 'group' : 'friend', ...partial }
}

/** A small but varied world: one dm, one group, text / voice / image / file messages. */
export function sampleWorld(extra: FakeSubstrateData = {}): FakeSubstrate {
  const dm = 'user_a'
  const group = 'grp_1@chatroom'
  const sessions = [
    session({ id: dm, title: '阿明', lastMessageAt: T0 + 10 * 60_000, unread: 2 }),
    session({ id: group, title: '项目组', lastMessageAt: T0 + 20 * 60_000, memberCount: 3 }),
    session({ id: 'gh_news', title: '新闻公众号', kind: 'official', lastMessageAt: T0 }),
  ]
  const contacts = [
    contact({ username: dm, nickname: '阿明', remark: '同事阿明' }),
    contact({ username: 'user_b', nickname: '小红' }),
    contact({ username: group, nickname: '项目组' }),
  ]
  const messages: WxMessage[] = [
    msg({ id: 'm1', sessionId: dm, seq: 1, senderId: dm, senderName: '阿明', text: '周五一起吃饭吗' }),
    msg({ id: 'm2', sessionId: dm, seq: 2, senderId: 'me', isSelf: true, text: '好啊，吃火锅' }),
    msg({ id: 'm3', sessionId: dm, seq: 3, senderId: dm, senderName: '阿明', kind: 'voice', text: '', media: { kind: 'voice', durationMs: 4200 } }),
    msg({ id: 'm4', sessionId: dm, seq: 4, senderId: dm, senderName: '阿明', kind: 'image', text: '', media: { kind: 'image', fileName: 'menu.jpg', sizeBytes: 2048 } }),
    msg({ id: 'm5', sessionId: dm, seq: 5, senderId: 'me', isSelf: true, kind: 'file', text: '', media: { kind: 'file', fileName: '预算.xlsx', sizeBytes: 40960 } }),
    msg({ id: 'm6', sessionId: dm, seq: 6, senderId: dm, senderName: '阿明', text: '火锅店订好了，周五七点' }),
    msg({ id: 'g1', sessionId: group, seq: 1, senderId: 'user_b', senderName: '小红', text: '周报今天要交' }),
    msg({ id: 'g2', sessionId: group, seq: 2, senderId: dm, senderName: '阿明', text: '收到，下午发周报' }),
    msg({ id: 'g3', sessionId: group, seq: 3, senderId: 'user_b', senderName: '小红', kind: 'image', text: '', media: { kind: 'image', fileName: 'chart.png' } }),
    msg({ id: 'g4', sessionId: group, seq: 4, senderId: 'user_b', senderName: '小红', text: '预算表也顺便更新一下' }),
  ]
  return createFakeSubstrate({
    sessions,
    contacts,
    messages,
    groupMembers: { [group]: [contacts[0]!, contacts[1]!, contact({ username: 'me', nickname: '我自己' })] },
    ...extra,
  })
}
