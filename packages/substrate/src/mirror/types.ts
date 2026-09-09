import type {
  EmbeddingClient,
  ListMessagesQuery,
  ListSessionsQuery,
  MessageAnchor,
  PageRequest,
  SearchHit,
  StatsQuery,
  StatsResult,
  WxContact,
  WxMedia,
  WxMessage,
  WxSession,
} from '@aiwc/protocol'

export interface MirrorOptions {
  /** SQLite file path (parent dirs are created) or ':memory:' for tests. */
  dbPath: string
  embeddings?: EmbeddingClient
}

export interface SessionFlags {
  pinned?: boolean
  muted?: boolean
  hidden?: boolean
  /** true = mark all read (unread → 0) */
  read?: boolean
}

export interface GroupMemberInput {
  username: string
  displayName?: string
}

export interface InsertResult {
  inserted: number
  /** Sessions that received at least one new message. */
  changedSessions: string[]
}

export interface SearchFilters {
  sessionIds?: string[]
  from?: number
  to?: number
  limit: number
}

/** Vector hit: anchored on the chunk's middle message, carrying the chunk's seq range for fusion/dedupe. */
export interface VectorSearchHit extends SearchHit {
  source: 'vector'
  range: { startSeq: number; endSeq: number }
}

export interface EnsureChunksResult {
  /** chunks created by this call */
  chunks: number
  /** vectors written by this call */
  embedded: number
  /** chunks still lacking a vector (no embeddings client, or embedding failed) */
  pending: number
  error?: string
}

export interface EnsureChunksOptions {
  /** First-time cap on how many recent messages to chunk (default 1500). */
  maxMessages?: number
  signal?: AbortSignal
  /** Skip embedding even when a client is configured (chunk only). */
  chunkOnly?: boolean
}

export interface ListContactsQuery extends PageRequest {
  query?: string
  kind?: WxContact['kind'] | 'all'
}

/**
 * Agent-owned SQLite mirror of one WeChat account: sessions / contacts / messages with two FTS5
 * indexes (unicode61 for latin, trigram for CJK), conversation chunks + float32 vectors, voice
 * transcript cache and the query_sql audit log. All methods are synchronous except ensureChunks /
 * searchSemantic (they may call the embeddings client).
 */
export interface Mirror {
  bindSource(identity: string): void
  readonly dbPath: string
  readonly embeddings: EmbeddingClient | undefined
  readonly hasEmbeddings: boolean

  meta: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    delete(key: string): void
  }

  // sessions / contacts
  upsertSessions(sessions: readonly WxSession[]): void
  getSession(id: string): WxSession | undefined
  listSessions(q: ListSessionsQuery): { items: WxSession[]; total: number; hasMore: boolean }
  setSessionFlags(sessionId: string, flags: SessionFlags): void
  /** Drop the local index of one session (messages, chunks, vectors, transcripts); the session row stays. */
  removeSession(sessionId: string): void
  upsertContacts(contacts: readonly WxContact[]): void
  getContact(username: string): WxContact | undefined
  listContacts(q: ListContactsQuery): { items: WxContact[]; total: number }
  upsertGroupMembers(groupId: string, members: readonly GroupMemberInput[]): void
  listGroupMembers(groupId: string, q?: PageRequest): { items: WxContact[]; total: number }
  hasGroupMembers(groupId: string): boolean

  // messages
  insertMessages(messages: readonly WxMessage[], options?: { advanceWatermark?: boolean }): InsertResult
  watermark(sessionId: string): number
  setWatermark(sessionId: string, seq: number, indexedUntil?: number): void
  listMessages(q: ListMessagesQuery): { items: WxMessage[]; hasMore: boolean }
  getMessage(sessionId: string, messageId: string): WxMessage | undefined
  getMessageBySeq(sessionId: string, seq: number): WxMessage | undefined
  getContext(anchor: MessageAnchor, radius: number): WxMessage[]
  oldestSeq(sessionId: string): number | undefined
  newestSeq(sessionId: string): number | undefined
  countMessages(sessionId?: string): number
  updateMedia(sessionId: string, messageId: string, media: WxMedia | undefined): void

  // search
  searchFts(query: string, opts: SearchFilters): SearchHit[]
  searchVector(queryVec: ArrayLike<number>, opts: SearchFilters): VectorSearchHit[]
  searchSemantic(query: string, opts: SearchFilters): Promise<VectorSearchHit[]>
  ensureChunks(sessionId: string, opts?: EnsureChunksOptions): Promise<EnsureChunksResult>
  invalidateVectorCache(): void

  // stats
  stats(q: StatsQuery): StatsResult

  // caches & audit
  transcripts: {
    get(sessionId: string, messageId: string): string | undefined
    set(sessionId: string, messageId: string, text: string): void
  }
  audit(sql: string, reason: string, rows: number): void
  auditLog(limit?: number): Array<{ at: number; sql: string; reason: string; rows: number }>

  close(): void
}
