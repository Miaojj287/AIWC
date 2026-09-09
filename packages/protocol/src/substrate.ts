/**
 * WeChat data substrate contract. The UI and the agent never touch WeChat files directly; they go
 * through SubstrateService. Implementations: WcdbSubstrate (real, in a utility process),
 * DemoSubstrate (dev fixtures), and the Mirror (agent-owned SQLite with FTS + vectors).
 */
import type { Millis } from './ids'

export interface WxAccount {
  wxid: string
  nickname?: string
  avatarPath?: string
  dbRoot: string
  verified: boolean
}

export type SessionKind = 'dm' | 'group' | 'official' | 'system'

export interface WxSession {
  collapsed?: boolean
  id: string /** username: wxid_xxx / xxx@chatroom / gh_xxx */
  kind: SessionKind
  title: string
  avatarPath?: string
  lastMessageAt?: Millis
  lastPreview?: string
  lastSender?: string
  unread: number
  pinned: boolean
  muted: boolean
  memberCount?: number
  /** Count of messages indexed locally for this session (real-time). */
  indexedCount?: number
  indexedUntil?: Millis
}

export interface WxContact {
  username: string
  nickname: string
  remark?: string
  alias?: string
  avatarPath?: string
  kind: 'friend' | 'group' | 'official' | 'stranger'
  lastContactAt?: Millis
}

export type MessageKind =
  | 'text' | 'image' | 'voice' | 'video' | 'file' | 'sticker' | 'link' | 'card'
  | 'location' | 'transfer' | 'quote' | 'system' | 'revoke' | 'other'

export interface WxMedia {
  kind: 'image' | 'voice' | 'video' | 'file' | 'sticker'
  path?: string
  thumbPath?: string
  durationMs?: number
  sizeBytes?: number
  fileName?: string
  /** Voice transcript if already produced. */
  transcript?: string
}

/** Structured, read-only presentation of a WeChat rich message. */
export interface WxRichContent {
  type: 'link' | 'article' | 'miniProgram' | 'channel' | 'music' | 'chatHistory' | 'contact' | 'location' | 'transfer' | 'redPacket' | 'announcement' | 'gift'
  title: string
  description?: string
  url?: string
  coverUrl?: string
  source?: string
  amount?: string
  status?: string
  entries?: Array<{ title: string; description?: string; url?: string; coverUrl?: string }>
}

export interface WxMessage {
  id: string /** local id */
  sessionId: string
  seq: number /** monotonically increasing sort key inside a session */
  createdAt: Millis
  senderId: string
  senderName?: string
  isSelf: boolean
  kind: MessageKind
  text: string
  media?: WxMedia
  rich?: WxRichContent
  presentationVersion?: number
  quote?: { senderName?: string; text: string }
  /** Compact reference used for evidence citation and jump-to. */
  anchor: MessageAnchor
}

export interface MessageAnchor {
  sessionId: string
  messageId: string
  seq: number
  createdAt: Millis
}

export interface PageRequest {
  offset?: number
  limit: number
}

export interface ListSessionsQuery extends PageRequest {
  kind?: SessionKind | 'all'
  query?: string
  unreadOnly?: boolean
  includeHidden?: boolean
}

export interface ListMessagesQuery {
  sessionId: string
  /** page backwards from this seq (exclusive) */
  beforeSeq?: number
  /** page forwards from this seq (exclusive) */
  afterSeq?: number
  limit: number
  from?: Millis
  to?: Millis
  senderIds?: string[]
  kinds?: MessageKind[]
}

export interface SearchQuery {
  query: string
  sessionIds?: string[]
  from?: Millis
  to?: Millis
  limit: number
  mode?: 'keyword' | 'semantic' | 'hybrid'
}

export interface SearchHit {
  message: WxMessage
  score: number
  snippet: string
  source: 'fts' | 'vector' | 'fused'
  /** For vector / fused hits: the conversation span (chunk) the match came from. */
  range?: { startSeq: number; endSeq: number }
}

export interface StatsQuery {
  sessionId?: string
  from?: Millis
  to?: Millis
  metric: 'overview' | 'ranking' | 'time_distribution'
  groupBy?: 'hour' | 'weekday' | 'day' | 'month'
  limit?: number
}

/**
 * `rows` is intentionally loose: the agent tools hand it straight to the model, so an implementation
 * may add columns. The reference implementation (the SQLite mirror) returns:
 *  - overview: one `{ key, value }` row per metric — 'total', 'self', 'others', 'sessions',
 *    'active_days', 'media', 'first_at', 'last_at' — plus one `kind:<MessageKind>` row per kind.
 *  - ranking (per sender or per session): { id, name, count, share, isSelf? / kind? }
 *  - time_distribution: { bucket (e.g. "09" / "Mon" / "2026-04-22" / "2026-04"), count }
 *
 * UI code MUST NOT index into `rows` by position or guess key names: read an overview through
 * `readStatsOverview` (src/platform/statsOverview.ts), which understands every shape shipped so far.
 */
export interface StatsResult {
  metric: StatsQuery['metric']
  rows: Array<Record<string, string | number>>
  total?: number
}

export type SyncPhase = 'idle' | 'syncing' | 'error'
export interface SyncStatus {
  phase: SyncPhase
  lastSyncedAt?: Millis
  progress?: { done: number; total: number; label?: string }
  error?: string
  totals?: { sessions: number; messages: number; media: number }
}

export type ConnectionState = 'no_config' | 'locked' | 'connecting' | 'ready' | 'error'

export type SubstrateEvent =
  | { type: 'connection'; state: ConnectionState; detail?: string }
  | { type: 'sync'; status: SyncStatus }
  | { type: 'messages.changed'; sessionIds: string[] }
  | { type: 'sessions.changed' }

/** Voice → text port. Implementations: local (sherpa-onnx) / online provider. */
export interface VoiceTranscriber {
  transcribe(audioPath: string, opts?: { language?: string; signal?: AbortSignal }): Promise<{ text: string; durationMs?: number }>
}

export interface SubstrateService {
  status(): { connection: ConnectionState; sync: SyncStatus; account?: WxAccount }
  listAccounts(): Promise<WxAccount[]>
  getAccount(): Promise<WxAccount | undefined>
  listSessions(q: ListSessionsQuery): Promise<{ items: WxSession[]; total: number; hasMore: boolean }>
  getSession(id: string): Promise<WxSession | undefined>
  listMessages(q: ListMessagesQuery): Promise<{ items: WxMessage[]; hasMore: boolean }>
  getMessage(sessionId: string, messageId: string): Promise<WxMessage | undefined>
  /** ±N messages around an anchor. */
  getContext(anchor: MessageAnchor, radius: number): Promise<WxMessage[]>
  search(q: SearchQuery): Promise<SearchHit[]>
  listContacts(q: { query?: string; kind?: WxContact['kind'] | 'all' } & PageRequest): Promise<{ items: WxContact[]; total: number }>
  getContact(username: string): Promise<WxContact | undefined>
  listGroupMembers(groupId: string, q?: PageRequest): Promise<{ items: WxContact[]; total: number }>
  stats(q: StatsQuery): Promise<StatsResult>
  /** Resolve (and decrypt if needed) a media path for a message. */
  resolveMedia(sessionId: string, messageId: string): Promise<WxMedia | undefined>
  transcribeVoice?(sessionId: string, messageId: string, opts?: { force?: boolean }): Promise<string>
  sync(opts?: { full?: boolean }): Promise<SyncStatus>
  subscribe(listener: (event: SubstrateEvent) => void): () => void
  /** Read-only SQL escape hatch (audited). Only whitelisted DBs, SELECT only. */
  querySql?(req: { db: 'message' | 'contact' | 'session'; sql: string; limit?: number }): Promise<{ columns: string[]; rows: unknown[][] }>
  /** Local-only session flags kept in the mirror (never written back to WeChat). */
  setSessionFlags?(sessionId: string, flags: { pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }): Promise<void>
  /** Drop a session's local index (messages, chunks, vectors); the source is untouched. */
  removeIndex?(sessionId: string): Promise<void>
  /** Drop and re-sync one session. */
  rebuildIndex?(sessionId: string): Promise<void>
}
