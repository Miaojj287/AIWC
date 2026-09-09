/**
 * substrate:* over the in-memory dataset — paging, filters, substring search with snippets, stats
 * computed in JS, context windows, generated media and a fake transcriber.
 */
import type {
  ConnectionState,
  KeyAcquireStep,
  SearchHit,
  StatsQuery,
  StatsResult,
  SyncStatus,
  WxContact,
  WxMedia,
  WxMessage,
  WxSession,
} from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'
import { contactFor, groupContacts, localDateKey, searchableText } from './dataset'
import { placeholderSvg, silentWav, textFileUrl } from './media'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface SubstrateState {
  hidden: Set<string>
  removedIndex: Set<string>
  connection: ConnectionState
  sync: SyncStatus
}

export function substrateHandlers(ctx: MockContext): HandlersFor<'substrate'> & { state: SubstrateState } {
  const { data } = ctx
  const state: SubstrateState = {
    hidden: new Set(),
    removedIndex: new Set(),
    connection: 'ready',
    sync: { phase: 'idle', lastSyncedAt: ctx.now() - 6 * 60_000 },
  }
  state.sync.totals = totals()

  function totals(): NonNullable<SyncStatus['totals']> {
    let messages = 0
    let media = 0
    for (const [sid, list] of data.messagesBySession) {
      if (state.removedIndex.has(sid)) continue
      messages += list.length
      for (const m of list) if (m.media) media++
    }
    return { sessions: data.sessions.size, messages, media }
  }

  const messagesOf = (sessionId: string): WxMessage[] =>
    state.removedIndex.has(sessionId) ? [] : data.messagesBySession.get(sessionId) ?? []

  const setSync = (patch: Partial<SyncStatus>) => {
    state.sync = { ...state.sync, ...patch }
    ctx.emit('substrate:event', { type: 'sync', status: state.sync })
  }

  async function runSync(label: string, sessionIds?: string[]): Promise<SyncStatus> {
    const total = sessionIds ? sessionIds.length : data.sessions.size
    setSync({ phase: 'syncing', progress: { done: 0, total, label }, error: undefined })
    const ticks = 4
    for (let i = 1; i <= ticks; i++) {
      await ctx.delay(350)
      setSync({ progress: { done: Math.round((total * i) / ticks), total, label } })
    }
    setSync({ phase: 'idle', progress: undefined, lastSyncedAt: ctx.now(), totals: totals() })
    ctx.emit('substrate:event', { type: 'sessions.changed' })
    if (sessionIds) ctx.emit('substrate:event', { type: 'messages.changed', sessionIds })
    return state.sync
  }

  function filterMessages(list: WxMessage[], q: { from?: number; to?: number; senderIds?: string[]; kinds?: string[] }): WxMessage[] {
    const senders = q.senderIds && q.senderIds.length ? new Set(q.senderIds) : undefined
    const kinds = q.kinds && q.kinds.length ? new Set(q.kinds) : undefined
    return list.filter(
      (m) =>
        (q.from === undefined || m.createdAt >= q.from) &&
        (q.to === undefined || m.createdAt <= q.to) &&
        (!senders || senders.has(m.senderId)) &&
        (!kinds || kinds.has(m.kind)),
    )
  }

  function snippetFor(text: string, needle: string): string {
    const lower = text.toLowerCase()
    const idx = lower.indexOf(needle)
    if (idx < 0) return text.slice(0, 60)
    const start = Math.max(0, idx - 18)
    const end = Math.min(text.length, idx + needle.length + 24)
    let window = text.slice(start, end)
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    window = window.replace(re, (m) => `<b>${m}</b>`)
    return `${start > 0 ? '…' : ''}${window}${end < text.length ? '…' : ''}`
  }

  function stats(q: StatsQuery): StatsResult {
    const pool: WxMessage[] = []
    if (q.sessionId) pool.push(...messagesOf(q.sessionId))
    else for (const sid of data.sessions.keys()) pool.push(...messagesOf(sid))
    const list = filterMessages(pool, q).filter((m) => m.kind !== 'system')

    if (q.metric === 'ranking') {
      const counts = new Map<string, { senderId: string; senderName: string; count: number }>()
      for (const m of list) {
        const row = counts.get(m.senderId) ?? { senderId: m.senderId, senderName: m.senderName ?? m.senderId, count: 0 }
        row.count++
        counts.set(m.senderId, row)
      }
      const rows = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, q.limit ?? 10)
      return {
        metric: 'ranking',
        rows: rows.map((r) => ({ ...r, ratio: list.length ? Math.round((r.count / list.length) * 1000) / 10 : 0 })),
        total: list.length,
      }
    }

    if (q.metric === 'time_distribution') {
      const groupBy = q.groupBy ?? 'hour'
      const buckets = new Map<string, { bucket: string; label: string; count: number; order: number }>()
      if (groupBy === 'hour') for (let h = 0; h < 24; h++) buckets.set(String(h), { bucket: String(h), label: `${String(h).padStart(2, '0')}:00`, count: 0, order: h })
      if (groupBy === 'weekday') for (let d = 0; d < 7; d++) buckets.set(String(d), { bucket: String(d), label: WEEKDAY_LABELS[d] ?? String(d), count: 0, order: d })
      for (const m of list) {
        const d = new Date(m.createdAt)
        let key: string
        let label: string
        let order: number
        if (groupBy === 'hour') {
          key = String(d.getHours())
          label = `${String(d.getHours()).padStart(2, '0')}:00`
          order = d.getHours()
        } else if (groupBy === 'weekday') {
          key = String(d.getDay())
          label = WEEKDAY_LABELS[d.getDay()] ?? key
          order = d.getDay()
        } else if (groupBy === 'month') {
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          label = `${d.getFullYear()}年${d.getMonth() + 1}月`
          order = d.getFullYear() * 12 + d.getMonth()
        } else {
          key = localDateKey(m.createdAt)
          label = `${d.getMonth() + 1}/${d.getDate()}`
          order = Math.floor(m.createdAt / 86_400_000)
        }
        const row = buckets.get(key) ?? { bucket: key, label, count: 0, order }
        row.count++
        buckets.set(key, row)
      }
      const rows = [...buckets.values()].sort((a, b) => a.order - b.order).map(({ bucket, label, count }) => ({ bucket, label, count }))
      return { metric: 'time_distribution', rows, total: list.length }
    }

    const days = new Set<string>()
    let self = 0
    let media = 0
    let firstAt = Number.POSITIVE_INFINITY
    let lastAt = 0
    for (const m of list) {
      days.add(localDateKey(m.createdAt))
      if (m.isSelf) self++
      if (m.media) media++
      if (m.createdAt < firstAt) firstAt = m.createdAt
      if (m.createdAt > lastAt) lastAt = m.createdAt
    }
    // Same keys as the real mirror (packages/substrate/src/mirror/stats.ts), including one
    // 'kind:<kind>' row per message kind — a preview that speaks a different vocabulary hides
    // exactly the bugs the preview exists to catch.
    const rows: StatsResult['rows'] = [
      { key: 'total', label: '消息', value: list.length },
      { key: 'self', label: '我发出', value: self },
      { key: 'others', label: '对方发出', value: list.length - self },
      { key: 'sessions', label: '会话数', value: new Set(list.map((m) => m.sessionId)).size },
      { key: 'active_days', label: '活跃天数', value: days.size },
      { key: 'media', label: '媒体', value: media },
      { key: 'first_at', label: '最早', value: Number.isFinite(firstAt) ? firstAt : 0 },
      { key: 'last_at', label: '最近', value: lastAt },
    ]
    const byKind = new Map<string, number>()
    for (const m of list) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1)
    for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) rows.push({ key: `kind:${kind}`, label: kind, value: count })
    return { metric: 'overview', rows, total: list.length }
  }

  function resolveMedia(sessionId: string, messageId: string): WxMedia | undefined {
    const m = data.messageById.get(messageId)
    if (!m || m.sessionId !== sessionId || !m.media) return undefined
    const media: WxMedia = { ...m.media }
    switch (media.kind) {
      case 'image':
        media.path = placeholderSvg('image', messageId, 960, 720)
        media.thumbPath = placeholderSvg('image', messageId, 320, 240)
        break
      case 'sticker':
        media.path = placeholderSvg('sticker', messageId, 240, 240)
        break
      case 'video':
        media.thumbPath = placeholderSvg('video', messageId, 640, 360)
        break
      case 'voice':
        media.path = silentWav(media.durationMs ?? 1000)
        break
      case 'file':
        media.path = textFileUrl(media.fileName ?? '文件', '演示环境中的文件占位内容。')
        break
    }
    return media
  }

  function fallbackTranscript(m: WxMessage): string {
    const candidates = messagesOf(m.sessionId).filter((x) => x.senderId === m.senderId && x.kind === 'text' && x.text.length > 4)
    return candidates.length ? ctx.rng.pick(candidates).text : '（未能识别出有效内容）'
  }

  const validateHex = (kind: 'db_key' | 'image_xor' | 'image_aes', hex: string): { ok: boolean; error?: string } => {
    const clean = hex.trim().toLowerCase()
    const len = kind === 'db_key' ? 64 : kind === 'image_aes' ? 32 : 2
    if (!/^[0-9a-f]+$/.test(clean)) return { ok: false, error: '只能包含 0-9 和 a-f' }
    if (clean.length !== len) return { ok: false, error: `长度应为 ${len} 位十六进制，当前 ${clean.length} 位` }
    return { ok: true }
  }

  const handlers: HandlersFor<'substrate'> = {
    'substrate:status': () => ({ connection: state.connection, sync: state.sync, account: data.account }),
    'substrate:detectWeChat': async () => {
      await ctx.delay(400)
      return { running: true, dbRoot: data.account.dbRoot, version: '4.0（演示）' }
    },
    'substrate:listAccounts': async () => {
      await ctx.delay(250)
      return [data.account]
    },
    'substrate:verifyAccount': async ({ wxid }) => {
      await ctx.delay(500)
      return wxid === data.account.wxid ? { ok: true } : { ok: false, error: '该账号与所选数据库目录不匹配' }
    },
    'substrate:acquireKeys': async () => {
      const steps: KeyAcquireStep[] = [
        { id: 'db_key', label: '数据库密钥', status: 'todo' },
        { id: 'image_xor', label: '图片 XOR 密钥', status: 'todo' },
        { id: 'image_aes', label: '图片 AES 密钥', status: 'todo' },
        { id: 'verify', label: '验证账号', status: 'todo' },
      ]
      for (const step of steps) {
        await ctx.delay(450)
        step.status = 'done'
        step.detail = step.id === 'verify' ? '目录与密钥匹配' : '演示环境：已生成占位密钥'
      }
      return steps
    },
    'substrate:setManualKey': ({ kind, hex }) => validateHex(kind, hex),
    'substrate:testConnection': async () => {
      await ctx.delay(500)
      return { ok: true }
    },
    'substrate:connect': async () => {
      state.connection = 'connecting'
      ctx.emit('substrate:event', { type: 'connection', state: 'connecting' })
      await ctx.delay(600)
      state.connection = 'ready'
      ctx.emit('substrate:event', { type: 'connection', state: 'ready', detail: '演示数据' })
      return { ok: true }
    },
    'substrate:sync': ({ full }) => runSync(full ? '全量同步' : '增量同步'),

    'substrate:listSessions': (q) => {
      const kind = q.kind ?? 'all'
      const needle = q.query?.trim().toLowerCase()
      const filtered = [...data.sessions.values()]
        .filter((s) => q.includeHidden || !state.hidden.has(s.id))
        .filter((s) => kind === 'all' || s.kind === kind)
        .filter((s) => !q.unreadOnly || s.unread > 0)
        .filter((s) => {
          if (!needle) return true
          const c = data.contacts.get(s.id)
          return [s.title, c?.nickname, c?.remark, c?.alias].some((v) => v?.toLowerCase().includes(needle))
        })
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      const offset = q.offset ?? 0
      const items = filtered.slice(offset, offset + q.limit)
      return { items, total: filtered.length, hasMore: offset + q.limit < filtered.length }
    },
    'substrate:getSession': ({ id }) => data.sessions.get(id),
    'substrate:listMessages': (q) => {
      const list = filterMessages(messagesOf(q.sessionId), q)
      if (q.beforeSeq !== undefined) {
        const older = list.filter((m) => m.seq < (q.beforeSeq as number))
        return { items: older.slice(-q.limit), hasMore: older.length > q.limit }
      }
      if (q.afterSeq !== undefined) {
        const newer = list.filter((m) => m.seq > (q.afterSeq as number))
        return { items: newer.slice(0, q.limit), hasMore: newer.length > q.limit }
      }
      return { items: list.slice(-q.limit), hasMore: list.length > q.limit }
    },
    'substrate:getContext': ({ anchor, radius }) => {
      const list = messagesOf(anchor.sessionId)
      let idx = list.findIndex((m) => m.id === anchor.messageId)
      if (idx < 0) idx = list.findIndex((m) => m.seq >= anchor.seq)
      if (idx < 0) return []
      return list.slice(Math.max(0, idx - radius), idx + radius + 1)
    },
    'substrate:search': async (q) => {
      const needle = q.query.trim().toLowerCase()
      if (!needle) return []
      await ctx.delay(120)
      const scope = q.sessionIds && q.sessionIds.length ? q.sessionIds : [...data.sessions.keys()]
      const span = Math.max(1, data.range.to - data.range.from)
      const hits: SearchHit[] = []
      for (const sid of scope) {
        for (const m of filterMessages(messagesOf(sid), q)) {
          const hay = searchableText(m)
          const lower = hay.toLowerCase()
          const first = lower.indexOf(needle)
          if (first < 0) continue
          let occurrences = 0
          for (let i = first; i >= 0; i = lower.indexOf(needle, i + needle.length)) occurrences++
          const recency = (m.createdAt - data.range.from) / span
          hits.push({ message: m, score: 1 + 0.2 * (occurrences - 1) + 0.5 * recency, snippet: snippetFor(hay, needle), source: 'fts' })
        }
      }
      hits.sort((a, b) => b.score - a.score)
      return hits.slice(0, q.limit)
    },
    'substrate:listContacts': (q) => {
      const kind = q.kind ?? 'all'
      const needle = q.query?.trim().toLowerCase()
      let pool: WxContact[] = kind === 'group' ? groupContacts(data) : kind === 'all' ? [...data.contactList, ...groupContacts(data)] : data.contactList.filter((c) => c.kind === kind)
      if (needle) pool = pool.filter((c) => [c.nickname, c.remark, c.alias, c.username].some((v) => v?.toLowerCase().includes(needle)))
      pool = [...pool].sort((a, b) => (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0))
      const offset = q.offset ?? 0
      return { items: pool.slice(offset, offset + q.limit), total: pool.length }
    },
    'substrate:listGroupMembers': ({ groupId, offset = 0, limit }) => {
      const ids = data.groupMembers[groupId] ?? []
      const members = ids.map((id) => contactFor(data, id))
      return { items: members.slice(offset, offset + limit), total: members.length }
    },
    'substrate:stats': (q) => stats(q),
    'substrate:resolveMedia': ({ sessionId, messageId }) => resolveMedia(sessionId, messageId),
    'substrate:transcribeVoice': async ({ sessionId, messageId, force }) => {
      const m = data.messageById.get(messageId)
      if (!m || m.sessionId !== sessionId || m.media?.kind !== 'voice') throw new Error('不是语音消息')
      await ctx.delay(800)
      if (force || !m.media.transcript) {
        m.media.transcript = fallbackTranscript(m)
        ctx.emit('substrate:event', { type: 'messages.changed', sessionIds: [sessionId] })
      }
      return m.media.transcript
    },
    'substrate:setSessionFlags': ({ sessionId, pinned, muted, hidden, read }) => {
      const s = data.sessions.get(sessionId)
      if (!s) return
      if (pinned !== undefined) s.pinned = pinned
      if (muted !== undefined) s.muted = muted
      if (read) s.unread = 0
      if (hidden !== undefined) {
        if (hidden) state.hidden.add(sessionId)
        else state.hidden.delete(sessionId)
      }
      ctx.emit('substrate:event', { type: 'sessions.changed' })
    },
    'substrate:removeIndex': async ({ sessionId }) => {
      await ctx.delay(300)
      state.removedIndex.add(sessionId)
      const s = data.sessions.get(sessionId)
      if (s) {
        s.indexedCount = 0
        delete s.indexedUntil
      }
      setSync({ totals: totals() })
      ctx.emit('substrate:event', { type: 'messages.changed', sessionIds: [sessionId] })
      ctx.emit('substrate:event', { type: 'sessions.changed' })
    },
    'substrate:rebuildIndex': async ({ sessionId }) => {
      state.removedIndex.delete(sessionId)
      const s = data.sessions.get(sessionId)
      const list = data.messagesBySession.get(sessionId) ?? []
      await runSync('重建索引', [sessionId])
      if (s) {
        s.indexedCount = list.length
        const last = list[list.length - 1]
        if (last) s.indexedUntil = last.createdAt
      }
    },
    'substrate:export': async ({ sessionId, format, outDir }) => {
      await ctx.delay(900)
      const s: WxSession | undefined = data.sessions.get(sessionId)
      const ext = format === 'excel' ? 'xlsx' : format === 'markdown' ? 'md' : format
      const dir = outDir ?? '~/Downloads/AIWC 导出'
      return { path: `${dir}/${s?.title ?? sessionId}-${localDateKey(ctx.now())}.${ext}` }
    },
  }

  return { ...handlers, state }
}
