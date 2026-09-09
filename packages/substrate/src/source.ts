/**
 * SourceReader = raw, read-only access to ONE WeChat account's data (WCDB on disk, or demo fixtures).
 * The Mirror (agent-owned SQLite) syncs from a SourceReader; the SubstrateFacade combines both into
 * the public SubstrateService. Implementations: WcdbSourceReader (packages/substrate/src/wcdb),
 * DemoSourceReader (packages/substrate/src/demo).
 */
import type { WxAccount, WxContact, WxMedia, WxMessage, WxSession } from '@aiwc/protocol'

export interface SourceOpenOptions {
  dbRoot: string
  wxid: string
  /** 64-hex SQLCipher key */
  dbKeyHex: string
  cacheDir: string
  imageKeys?: { xorHex?: string; aesHex?: string }
}

export interface SourceReader {
  readonly kind: 'wcdb' | 'demo'
  open(opts: SourceOpenOptions): Promise<void>
  close(): Promise<void>
  isOpen(): boolean
  account(): Promise<WxAccount>
  /** All sessions. Large sources may publish complete pages early so the UI can paint immediately. */
  sessions(onPage?: (sessions: readonly WxSession[]) => void): Promise<WxSession[]>
  contacts(): Promise<WxContact[]>
  groupMembers(groupId: string): Promise<WxContact[]>
  /**
   * Messages of a session with seq > afterSeq, ascending, at most limit. Used for incremental sync
   * and for live paging when the mirror is behind.
   */
  messagesAfter(sessionId: string, afterSeq: number, limit: number): Promise<WxMessage[]>
  /** Messages with seq < beforeSeq, descending, at most limit (live backward paging). */
  messagesBefore(sessionId: string, beforeSeq: number, limit: number): Promise<WxMessage[]>
  /** Resolve / decrypt media for a message into cacheDir. */
  resolveMedia(message: WxMessage): Promise<WxMedia | undefined>
  /** Change notifications from the underlying store (WCDB file mtime / WAL watch). */
  watch(listener: (change: { sessionIds?: string[] }) => void): () => void
  /** Optional raw SQL for the audited query_sql tool. */
  querySql?(db: 'message' | 'contact' | 'session', sql: string, limit: number): Promise<{ columns: string[]; rows: unknown[][] }>
}
