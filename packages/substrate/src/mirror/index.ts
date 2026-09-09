import { openMirrorDb } from './schema'
import { createSessionOps } from './sessions'
import { createMessageOps } from './messages'
import { createSearchOps } from './search'
import { createStatsOps } from './stats'
import type { Mirror, MirrorOptions } from './types'

export type {
  Mirror,
  MirrorOptions,
  SessionFlags,
  GroupMemberInput,
  InsertResult,
  SearchFilters,
  EnsureChunksResult,
  EnsureChunksOptions,
  ListContactsQuery,
  VectorSearchHit,
} from './types'
export { buildChunks, chunkExcerpt, CHUNK_MAX_CHARS, CHUNK_MAX_MSGS, CHUNK_GAP_MS, type BuiltChunk, type ChunkInput } from './chunks'
export { reciprocalRankFusion, fuseHits, alignVectorHits, hitKey, type RrfRankedItem, type RrfMergedItem } from './rrf'
export { buildFtsQueries, type FtsQueries } from './search'
export { MIRROR_SCHEMA_VERSION } from './schema'

export function createMirror(opts: MirrorOptions): Mirror {
  const db = openMirrorDb(opts.dbPath)
  const embeddings = opts.embeddings
  const sessions = createSessionOps(db)
  const messages = createMessageOps(db)
  const search = createSearchOps(db, messages, embeddings)
  const stats = createStatsOps(db)

  const mirror: Mirror = {
    dbPath: opts.dbPath,
    embeddings,
    hasEmbeddings: embeddings !== undefined,

    bindSource(identity) {
      if (mirror.meta.get('source_identity') === identity) return
      db.tx(() => {
        for (const table of ['messages', 'chunk_vectors', 'chunks', 'voice_transcripts', 'group_members', 'contacts', 'sessions']) db.run(`DELETE FROM ${table}`)
        mirror.meta.set('source_identity', identity)
      })
      search.invalidateVectorCache()
    },

    meta: {
      get: (key) => db.get<{ v: string }>('SELECT v FROM meta WHERE k = ?', key)?.v,
      set: (key, value) => {
        db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', key, value)
      },
      delete: (key) => {
        db.run('DELETE FROM meta WHERE k = ?', key)
      },
    },

    upsertSessions: sessions.upsertSessions,
    getSession: sessions.getSession,
    listSessions: sessions.listSessions,
    setSessionFlags: sessions.setSessionFlags,
    removeSession: (sessionId) => {
      messages.removeSession(sessionId)
      search.invalidateVectorCache()
    },
    upsertContacts: sessions.upsertContacts,
    getContact: sessions.getContact,
    listContacts: sessions.listContacts,
    upsertGroupMembers: sessions.upsertGroupMembers,
    listGroupMembers: sessions.listGroupMembers,
    hasGroupMembers: sessions.hasGroupMembers,

    insertMessages: messages.insertMessages,
    watermark: messages.watermark,
    setWatermark: messages.setWatermark,
    listMessages: messages.listMessages,
    getMessage: messages.getMessage,
    getMessageBySeq: messages.getMessageBySeq,
    getContext: messages.getContext,
    oldestSeq: messages.oldestSeq,
    newestSeq: messages.newestSeq,
    countMessages: messages.countMessages,
    updateMedia: messages.updateMedia,

    searchFts: search.searchFts,
    searchVector: search.searchVector,
    searchSemantic: search.searchSemantic,
    ensureChunks: search.ensureChunks,
    invalidateVectorCache: search.invalidateVectorCache,

    stats: stats.stats,

    transcripts: messages.transcripts,
    audit: messages.audit,
    auditLog: messages.auditLog,

    close: () => db.close(),
  }
  return mirror
}
