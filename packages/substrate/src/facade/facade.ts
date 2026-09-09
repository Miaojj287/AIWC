/**
 * SubstrateFacade = SourceReader (live WeChat / demo) + Mirror (local index) behind the public
 * SubstrateService. Reads prefer the mirror; when the mirror is behind, it falls back to the live
 * source and backfills. Connection state machine: no_config → connecting → ready | locked | error.
 */
import { existsSync } from 'node:fs'
import type {
  ConnectionState,
  ListMessagesQuery,
  MessageAnchor,
  SearchHit,
  SearchQuery,
  SubstrateEvent,
  SubstrateService,
  VoiceTranscriber,
  WxAccount,
  WxMedia,
  WxMessage,
} from '@aiwc/protocol'
import type { SourceOpenOptions, SourceReader } from '../source'
import type { Mirror, SessionFlags, VectorSearchHit } from '../mirror/types'
import { alignVectorHits, fuseHits } from '../mirror/rrf'
import { createSyncEngine, type SyncEngine } from './sync'
import { SubstrateError, looksLikeLockedError, toSubstrateError } from '../shared/errors'
import { guardSelectSql } from '../shared/sqlGuard'

export interface SubstrateFacadeOptions {
  source: SourceReader
  mirror: Mirror
  transcriber?: VoiceTranscriber
  cacheDir: string
  /** Start an incremental sync right after openWith() (default true). */
  autoSyncOnOpen?: boolean
  watchDebounceMs?: number
  pageSize?: number
  /** How many recent sessions to chunk/embed when a semantic search has no session scope (default 30). */
  semanticSessionScope?: number
}

export type SubstrateFacade = SubstrateService & {
  openWith(opts: SourceOpenOptions): Promise<void>
  close(): Promise<void>
  setSessionFlags(sessionId: string, flags: SessionFlags): Promise<void>
  removeIndex(sessionId: string): Promise<void>
  rebuildIndex(sessionId: string): Promise<void>
  transcribeVoice(sessionId: string, messageId: string, opts?: { force?: boolean }): Promise<string>
  querySql(req: { db: 'message' | 'contact' | 'session'; sql: string; limit?: number }): Promise<{ columns: string[]; rows: unknown[][] }>
  readonly mirror: Mirror
  readonly source: SourceReader
  readonly syncEngine: SyncEngine
}

const hasMessageFilters = (q: ListMessagesQuery): boolean =>
  q.from !== undefined || q.to !== undefined || Boolean(q.senderIds?.length) || Boolean(q.kinds?.length)

export function createSubstrateFacade(opts: SubstrateFacadeOptions): SubstrateFacade {
  const { source, mirror, transcriber, cacheDir } = opts
  const listeners = new Set<(event: SubstrateEvent) => void>()
  let connection: ConnectionState = 'no_config'
  let account: WxAccount | undefined
  let unwatch: (() => void) | undefined
  /** Sessions for which the live source returned nothing older than the mirror's oldest message. */
  const liveExhausted = new Set<string>()

  const emit = (event: SubstrateEvent) => {
    for (const l of listeners) {
      try {
        l(event)
      } catch {
        /* a bad listener must not break the facade */
      }
    }
  }

  const setConnection = (state: ConnectionState, detail?: string) => {
    connection = state
    emit(detail ? { type: 'connection', state, detail } : { type: 'connection', state })
  }

  const engine = createSyncEngine({ source, mirror, emit, pageSize: opts.pageSize, watchDebounceMs: opts.watchDebounceMs })

  const requireOpen = () => {
    if (connection !== 'ready' || !account || !source.isOpen()) throw new SubstrateError('not_open', '尚未连接微信数据')
  }

  const backfillBefore = async (sessionId: string, beforeSeq: number, limit: number): Promise<WxMessage[]> => {
    const live = await source.messagesBefore(sessionId, beforeSeq, limit)
    if (live.length) mirror.insertMessages(live, { advanceWatermark: false })
    return live
  }

  // Old mirrors contain only display text. Upgrade visible legacy rows lazily from the source;
  // never reset the user's index or discard media/transcript caches.
  const upgradePresentation = async (items: WxMessage[]): Promise<WxMessage[]> => {
    if (!source.isOpen() || source.kind !== 'wcdb') return items
    const upgraded: WxMessage[] = []
    for (const message of items) {
      if (message.presentationVersion) { upgraded.push(message); continue }
      try {
        const page = await source.messagesAfter(message.sessionId, message.seq - 1, 1)
        const fresh = page.find((m) => m.seq === message.seq && (m.id === message.id || m.id === `wx:${message.id}:${message.seq}`))
        if (fresh?.presentationVersion) {
          mirror.insertMessages([fresh], { advanceWatermark: false })
          upgraded.push(mirror.getMessage(message.sessionId, fresh.id) ?? message)
          continue
        }
      } catch { /* Keep the readable cached row if the original is unavailable. */ }
      upgraded.push(message)
    }
    return upgraded
  }

  const listMessages: SubstrateService['listMessages'] = async (q) => {
    requireOpen()
    const limit = Math.max(1, Math.floor(q.limit || 50))
    const local = mirror.listMessages({ ...q, limit })
    if (!source.isOpen() || q.afterSeq !== undefined || hasMessageFilters(q)) return { ...local, items: await upgradePresentation(local.items) }
    const oldestLocal = mirror.oldestSeq(q.sessionId)
    // The mirror is filled oldest-first by the background sync. A full local page therefore does not
    // prove that it is the current tail. Ask the live message shards for every unfiltered latest/older
    // page; this keeps the detail pane aligned with session.db even while indexing is still running.
    const boundary = q.beforeSeq ?? Number.MAX_SAFE_INTEGER
    if (liveExhausted.has(q.sessionId) && (oldestLocal === undefined || boundary <= oldestLocal)) return { ...local, items: await upgradePresentation(local.items) }
    try {
      const live = await backfillBefore(q.sessionId, boundary, limit)
      if (!live.length) {
        if (oldestLocal === undefined || boundary <= oldestLocal) liveExhausted.add(q.sessionId)
        return { items: local.items, hasMore: false }
      }
      const merged = mirror.listMessages({ ...q, limit })
      return { items: merged.items, hasMore: merged.hasMore || live.length >= limit }
    } catch {
      return local
    }
  }

  const getContext = async (anchor: MessageAnchor, radius: number): Promise<WxMessage[]> => {
    requireOpen()
    const r = Math.max(0, Math.floor(radius))
    const local = mirror.getContext(anchor, r)
    const hasAnchor = local.some((m) => m.id === anchor.messageId)
    if (!source.isOpen() || (hasAnchor && local.length >= 2 * r + 1)) return upgradePresentation(local)
    try {
      const [before, after] = await Promise.all([
        source.messagesBefore(anchor.sessionId, anchor.seq, r),
        source.messagesAfter(anchor.sessionId, anchor.seq - 1, r + 1),
      ])
      const fresh = [...before, ...after]
      if (fresh.length) mirror.insertMessages(fresh, { advanceWatermark: false })
      return mirror.getContext(anchor, r)
    } catch {
      return local
    }
  }

  const ensureScopedChunks = async (sessionIds: string[] | undefined) => {
    const ids = sessionIds?.length ? sessionIds : mirror.listSessions({ limit: opts.semanticSessionScope ?? 30 }).items.map((s) => s.id)
    for (const id of ids) {
      try {
        await mirror.ensureChunks(id)
      } catch {
        /* embedding failures fall back to keyword search */
      }
    }
  }

  const search = async (q: SearchQuery): Promise<SearchHit[]> => {
    requireOpen()
    const query = q.query.trim()
    const limit = Math.max(1, Math.floor(q.limit || 20))
    if (!query) return []
    const filters = { sessionIds: q.sessionIds, from: q.from, to: q.to, limit }
    const mode = q.mode ?? 'keyword'
    if (mode === 'keyword' || !mirror.hasEmbeddings) return mirror.searchFts(query, filters)
    await ensureScopedChunks(q.sessionIds)
    if (mode === 'semantic') {
      try {
        const hits = await mirror.searchSemantic(query, filters)
        return hits.length ? hits : mirror.searchFts(query, filters)
      } catch {
        return mirror.searchFts(query, filters)
      }
    }
    const fts = mirror.searchFts(query, { ...filters, limit: limit * 2 })
    let vec: VectorSearchHit[] = []
    try {
      vec = await mirror.searchSemantic(query, { ...filters, limit: limit * 2 })
    } catch {
      vec = []
    }
    if (!vec.length) return fts.slice(0, limit)
    if (!fts.length) return vec.slice(0, limit)
    return fuseHits([fts, alignVectorHits(vec, fts)], limit)
  }

  const resolveMedia = async (sessionId: string, messageId: string): Promise<WxMedia | undefined> => {
    requireOpen()
    const m = mirror.getMessage(sessionId, messageId)
    if (!m) throw new SubstrateError('not_found', '找不到这条消息')
    if (m.media?.path && existsSync(m.media.path)) return m.media
    if (!source.isOpen()) return m.media
    const resolved = await source.resolveMedia(m)
    if (!resolved) return m.media
    const merged: WxMedia = { ...m.media, ...resolved }
    mirror.updateMedia(sessionId, messageId, merged)
    return merged
  }

  const transcribeVoice = async (sessionId: string, messageId: string, o?: { force?: boolean }): Promise<string> => {
    requireOpen()
    if (!o?.force) {
      const cached = mirror.transcripts.get(sessionId, messageId)
      if (cached) return cached
      const existing = mirror.getMessage(sessionId, messageId)?.media?.transcript
      if (existing) {
        mirror.transcripts.set(sessionId, messageId, existing)
        return existing
      }
    }
    if (!transcriber) throw new SubstrateError('unsupported', '未配置语音转文字，请在设置里选择本地或在线模型')
    const media = await resolveMedia(sessionId, messageId)
    if (!media?.path) throw new SubstrateError('not_found', '找不到语音文件')
    const { text } = await transcriber.transcribe(media.path)
    mirror.transcripts.set(sessionId, messageId, text)
    mirror.updateMedia(sessionId, messageId, { ...media, transcript: text })
    return text
  }

  const querySql: SubstrateFacade['querySql'] = async (req) => {
    const guarded = guardSelectSql(req.sql, req.limit)
    requireOpen()
    if (!source.querySql) throw new SubstrateError('unsupported', '当前数据源不支持 SQL 查询')
    try {
      const result = await source.querySql(req.db, guarded.sql, guarded.limit)
      mirror.audit(guarded.sql, `query_sql:${req.db}`, result.rows.length)
      return result
    } catch (err) {
      mirror.audit(guarded.sql, `query_sql:${req.db}:error`, -1)
      throw toSubstrateError(err, 'sql_rejected')
    }
  }

  const closeSource = async () => {
    unwatch?.()
    unwatch = undefined
    engine.cancel()
    if (source.isOpen()) await source.close()
    account = undefined
    liveExhausted.clear()
  }

  const facade: SubstrateFacade = {
    mirror,
    source,
    syncEngine: engine,

    status: () => (account ? { connection, sync: engine.status, account } : { connection, sync: engine.status }),

    async openWith(o) {
      if (source.isOpen()) await closeSource()
      setConnection('connecting')
      try {
        await source.open({ ...o, cacheDir: o.cacheDir || cacheDir })
        account = await source.account()
        mirror.bindSource(JSON.stringify([source.kind, o.dbRoot, account.wxid]))
      } catch (err) {
        const e = toSubstrateError(err)
        const locked = e.code === 'locked' || e.code === 'invalid_key' || looksLikeLockedError(err)
        setConnection(locked ? 'locked' : 'error', e.message)
        throw e
      }
      setConnection('ready')
      unwatch = source.watch((change) => engine.schedule(change.sessionIds))
      if (opts.autoSyncOnOpen !== false) void engine.run({}).catch(() => {})
    },

    async close() {
      engine.stop()
      await closeSource()
      setConnection('no_config')
    },

    listAccounts: async () => (account ? [account] : []),
    getAccount: async () => account,
    listSessions: async (q) => { requireOpen(); return mirror.listSessions(q) },
    getSession: async (id) => { requireOpen(); return mirror.getSession(id) },
    listMessages,
    getMessage: async (sessionId, messageId) => { requireOpen(); const m = mirror.getMessage(sessionId, messageId); return m ? (await upgradePresentation([m]))[0] : undefined },
    getContext,
    search,
    listContacts: async (q) => { requireOpen(); return mirror.listContacts({ query: q.query, kind: q.kind, limit: q.limit, offset: q.offset }) },
    getContact: async (username) => { requireOpen(); return mirror.getContact(username) },
    async listGroupMembers(groupId, q) {
      requireOpen()
      const local = mirror.listGroupMembers(groupId, q)
      if (local.total > 0 || !source.isOpen()) return local
      try {
        const members = await source.groupMembers(groupId)
        if (members.length) {
          mirror.upsertContacts(members)
          mirror.upsertGroupMembers(groupId, members.map((c) => ({ username: c.username, displayName: c.remark || c.nickname || undefined })))
          return mirror.listGroupMembers(groupId, q)
        }
      } catch {
        /* fall through */
      }
      return local
    },
    stats: async (q) => { requireOpen(); return mirror.stats(q) },
    resolveMedia,
    transcribeVoice,
    async sync(o) {
      requireOpen()
      return engine.run({ full: o?.full })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    querySql,

    async setSessionFlags(sessionId, flags) {
      mirror.setSessionFlags(sessionId, flags)
      emit({ type: 'sessions.changed' })
    },
    async removeIndex(sessionId) {
      mirror.removeSession(sessionId)
      liveExhausted.delete(sessionId)
      emit({ type: 'messages.changed', sessionIds: [sessionId] })
      emit({ type: 'sessions.changed' })
    },
    async rebuildIndex(sessionId) {
      mirror.removeSession(sessionId)
      liveExhausted.delete(sessionId)
      emit({ type: 'messages.changed', sessionIds: [sessionId] })
      if (source.isOpen()) await engine.run({ sessionIds: [sessionId], full: true })
    },
  }
  return facade
}
