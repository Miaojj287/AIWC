/**
 * Message tables are named `Msg_<md5(sessionId)>` and spread over `message_N.db` / `biz_message_N.db`
 * shards. This index caches per-shard table lists (60 s TTL, rescanned when new shard files appear),
 * table column shapes, Name2Id availability and the account owner's Name2Id rowid.
 */
import { createHash } from 'node:crypto'
import type { MessageShard, MessageShardKind } from './dbFiles'
import { quoteIdent, type WcdbQuery } from './query'

export const TABLE_LIST_TTL_MS = 60_000

export interface MessageTableRef {
  dbPath: string
  tableName: string
  kind: MessageShardKind
}

export interface MessageTableColumns {
  names: Set<string>
  hasSortSeq: boolean
  hasCreateTime: boolean
  hasLocalId: boolean
  hasRealSenderId: boolean
  hasIsSend: boolean
  hasServerId: boolean
  /** sort_seq present and never 0/NULL → the indexed column can be used directly as seq. */
  sortSeqAllPositive: boolean
}

export function messageTableHash(sessionId: string): string {
  return createHash('md5').update(sessionId).digest('hex').toLowerCase()
}

export function extractMessageTableHash(tableName: string): string | null {
  // WeChat builds may append a table suffix; the 32-character hash remains the session identity.
  const match = /^msg_([0-9a-f]{32})(?:$|_)/i.exec(String(tableName))
  return match?.[1]?.toLowerCase() ?? null
}

interface ShardTables {
  hashes: Map<string, string[]> // hash → every actual table name
  scannedAt: number
}

export class MessageTableIndex {
  private readonly shardTables = new Map<string, ShardTables>()
  private readonly columnCache = new Map<string, MessageTableColumns>()
  private readonly name2IdCache = new Map<string, boolean>()
  private readonly myRowIdCache = new Map<string, number | null>()

  constructor(
    private readonly q: WcdbQuery,
    private readonly listShards: () => MessageShard[],
    private readonly now: () => number = Date.now,
  ) {}

  /** Every shard/table pair that holds messages for the session. */
  tablesFor(sessionId: string): MessageTableRef[] {
    const hash = messageTableHash(sessionId)
    const refs: MessageTableRef[] = []
    for (const shard of this.listShards()) {
      const tables = this.tablesOfShard(shard.dbPath)
      for (const tableName of tables.hashes.get(hash) ?? []) refs.push({ dbPath: shard.dbPath, tableName, kind: shard.kind })
    }
    return refs
  }

  columns(ref: MessageTableRef): MessageTableColumns {
    const key = `${ref.dbPath}\0${ref.tableName}`
    const cached = this.columnCache.get(key)
    if (cached) return cached
    const names = new Set(this.q.columns(ref.dbPath, ref.tableName))
    const lower = new Set(Array.from(names, (n) => n.toLowerCase()))
    const hasSortSeq = lower.has('sort_seq')
    let sortSeqAllPositive = false
    if (hasSortSeq) {
      try {
        const row = this.q.get(ref.dbPath, `SELECT COUNT(*) AS c FROM ${quoteIdent(ref.tableName)} WHERE sort_seq IS NULL OR sort_seq <= 0`)
        sortSeqAllPositive = Number(row?.['c'] ?? 1) === 0
      } catch {
        sortSeqAllPositive = false
      }
    }
    const result: MessageTableColumns = {
      names,
      hasSortSeq,
      hasCreateTime: lower.has('create_time'),
      hasLocalId: lower.has('local_id'),
      hasRealSenderId: lower.has('real_sender_id'),
      hasIsSend: lower.has('is_send'),
      hasServerId: lower.has('server_id'),
      sortSeqAllPositive,
    }
    this.columnCache.set(key, result)
    return result
  }

  hasName2Id(dbPath: string): boolean {
    const cached = this.name2IdCache.get(dbPath)
    if (cached !== undefined) return cached
    let exists = false
    try {
      exists = this.q.tableExists(dbPath, 'Name2Id')
    } catch {
      exists = false
    }
    this.name2IdCache.set(dbPath, exists)
    return exists
  }

  /** rowid of the account owner in the shard's Name2Id (tries raw dir name and cleaned wxid). */
  myRowId(dbPath: string, candidates: readonly string[]): number | null {
    const key = `${dbPath}\0${candidates.join('|')}`
    const cached = this.myRowIdCache.get(key)
    if (cached !== undefined) return cached
    let found: number | null = null
    if (this.hasName2Id(dbPath)) {
      for (const candidate of candidates) {
        if (!candidate) continue
        try {
          const row = this.q.get(dbPath, 'SELECT rowid AS rid FROM Name2Id WHERE user_name = ?', [candidate])
          const rid = Number(row?.['rid'])
          if (Number.isFinite(rid) && rid > 0) {
            found = rid
            break
          }
        } catch {
          // try next candidate
        }
      }
    }
    this.myRowIdCache.set(key, found)
    return found
  }

  /** Forget table lists (new shards / tables may have appeared). Column shapes stay cached. */
  invalidate(): void {
    this.shardTables.clear()
  }

  /** Drop everything, including per-table column info (used on close / corruption). */
  reset(): void {
    this.shardTables.clear()
    this.columnCache.clear()
    this.name2IdCache.clear()
    this.myRowIdCache.clear()
  }

  private tablesOfShard(dbPath: string): ShardTables {
    const cached = this.shardTables.get(dbPath)
    if (cached && this.now() - cached.scannedAt < TABLE_LIST_TTL_MS) return cached
    const hashes = new Map<string, string[]>()
    try {
      for (const name of this.q.tables(dbPath, 'msg_%')) {
        const hash = extractMessageTableHash(name)
        if (hash) hashes.set(hash, [...(hashes.get(hash) ?? []), name])
      }
    } catch {
      // unreadable shard: treat as empty but retry after TTL
    }
    const entry = { hashes, scannedAt: this.now() }
    this.shardTables.set(dbPath, entry)
    return entry
  }
}
