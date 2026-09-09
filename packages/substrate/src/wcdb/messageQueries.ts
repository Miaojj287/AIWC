/**
 * Seq-cursor message queries merged across every shard that holds a table for the session.
 * Each shard is queried with LIMIT, results are merge-sorted by seq and de-duplicated
 * (the same row can exist in two shards after WeChat re-shards).
 */
import type { WxMessage } from '@aiwc/protocol'
import { isGroupUsername } from './accountUtils'
import {
  deriveSeq,
  messageIdentityKey,
  readRawInfo,
  rowToWxMessage,
  type MessageRawInfo,
} from './messageMapper'
import { quoteIdent, yieldToLoop, type WcdbQuery } from './query'
import type { Row } from './rowDecoders'
import type { MessageTableColumns, MessageTableIndex, MessageTableRef } from './tableResolver'

export interface MessageQueryContext {
  q: WcdbQuery
  index: MessageTableIndex
  /** Account directory name (senderId of own messages). */
  selfWxid: string
  /** Name2Id candidates for self (raw dir name + cleaned wxid). */
  selfKeys: readonly string[]
  resolveName: (sessionId: string, username: string) => string | undefined
  /** Called for a shard that reports corruption; lets the owner drop cached handles. */
  onShardError?: (dbPath: string, error: unknown) => void
}

const MAX_ROWS_PER_CALL = 2000

/** SQL expression for the message seq, honouring the table's column shape. */
export function seqExpression(alias: string, cols: MessageTableColumns): string {
  const a = alias ? `${alias}.` : ''
  if (cols.hasSortSeq && cols.sortSeqAllPositive) return `${a}sort_seq`
  if (cols.hasSortSeq) return `CASE WHEN ${a}sort_seq > 0 THEN ${a}sort_seq ELSE ${a}create_time * 1000 + ${a}local_id END`
  return `${a}create_time * 1000 + ${a}local_id`
}

interface SelectPlan {
  sql: string
  params: Array<number | string>
  myRowId: number | null
}

function buildSelect(ctx: MessageQueryContext, ref: MessageTableRef, where: string, orderDir: 'ASC' | 'DESC', limit: number, whereParams: number[]): SelectPlan {
  const cols = ctx.index.columns(ref)
  const hasName2Id = ctx.index.hasName2Id(ref.dbPath) && cols.hasRealSenderId
  const myRowId = hasName2Id ? ctx.index.myRowId(ref.dbPath, ctx.selfKeys) : null
  const seq = seqExpression('m', cols)
  const table = quoteIdent(ref.tableName)
  const params: Array<number | string> = []
  let select = 'SELECT m.*'
  let join = ''
  if (hasName2Id) {
    select += ', n.user_name AS sender_username'
    join = ' LEFT JOIN Name2Id n ON m.real_sender_id = n.rowid'
    if (myRowId !== null) {
      select += ', CASE WHEN m.real_sender_id = ? THEN 1 ELSE 0 END AS computed_is_send'
      params.push(myRowId)
    }
  }
  params.push(...whereParams, Math.max(1, Math.min(MAX_ROWS_PER_CALL, limit)))
  const sql = `${select} FROM ${table} m${join} WHERE ${where.replace(/\{seq\}/g, seq)} ORDER BY ${seq} ${orderDir} LIMIT ?`
  return { sql, params, myRowId }
}

interface Collected {
  message: WxMessage
  raw: MessageRawInfo
}

function collect(ctx: MessageQueryContext, sessionId: string, ref: MessageTableRef, plan: SelectPlan, out: Map<string, Collected>): void {
  let rows: Row[]
  try {
    rows = ctx.q.all(ref.dbPath, plan.sql, plan.params)
  } catch (error) {
    ctx.onShardError?.(ref.dbPath, error)
    return
  }
  const isGroup = isGroupUsername(sessionId)
  for (const row of rows) {
    const raw = readRawInfo(row)
    const key = messageIdentityKey(raw)
    if (out.has(key)) continue
    const message = rowToWxMessage(row, {
      sessionId,
      isGroup,
      selfWxid: ctx.selfWxid,
      myRowId: plan.myRowId,
      resolveName: (username) => ctx.resolveName(sessionId, username),
    })
    out.set(key, { message, raw })
  }
}

async function queryDirection(ctx: MessageQueryContext, sessionId: string, cursorSeq: number, limit: number, direction: 'after' | 'before'): Promise<WxMessage[]> {
  const refs = ctx.index.tablesFor(sessionId)
  if (refs.length === 0) return []
  const safeLimit = Math.max(1, Math.floor(limit))
  const out = new Map<string, Collected>()
  const where = direction === 'after' ? '{seq} > ?' : '{seq} < ?'
  const cursor = direction === 'before' && !Number.isFinite(cursorSeq) ? Number.MAX_SAFE_INTEGER : cursorSeq
  for (const ref of refs) {
    const plan = buildSelect(ctx, ref, where, direction === 'after' ? 'ASC' : 'DESC', safeLimit, [cursor])
    collect(ctx, sessionId, ref, plan, out)
    if (refs.length > 1) await yieldToLoop()
  }
  const list = Array.from(out.values()).map((c) => c.message)
  list.sort((a, b) => (direction === 'after' ? a.seq - b.seq : b.seq - a.seq) || a.createdAt - b.createdAt || Number(a.id) - Number(b.id))
  return list.slice(0, safeLimit)
}

/** Messages with seq > afterSeq, ascending. */
export function queryMessagesAfter(ctx: MessageQueryContext, sessionId: string, afterSeq: number, limit: number): Promise<WxMessage[]> {
  return queryDirection(ctx, sessionId, Math.max(0, afterSeq), limit, 'after')
}

/** Messages with seq < beforeSeq, descending. */
export function queryMessagesBefore(ctx: MessageQueryContext, sessionId: string, beforeSeq: number, limit: number): Promise<WxMessage[]> {
  return queryDirection(ctx, sessionId, beforeSeq, limit, 'before')
}

export interface LocatedRow {
  row: Row
  raw: MessageRawInfo
  ref: MessageTableRef
  myRowId: number | null
}

/** Find one message row by local id (falls back to server id / seq) across shards. */
export function findMessageRow(ctx: MessageQueryContext, sessionId: string, messageId: string, seq?: number): LocatedRow | undefined {
  const qualified = /^wx:(\d+):(\d+)$/.exec(messageId)
  if (qualified && seq === undefined) seq = Number(qualified[2])
  const numeric = qualified ? Number(qualified[1]) : /^\d+$/.test(messageId) ? Number(messageId) : Number.NaN
  for (const ref of ctx.index.tablesFor(sessionId)) {
    const cols = ctx.index.columns(ref)
    const attempts: Array<{ where: string; params: number[] }> = []
    if (Number.isFinite(numeric)) {
      if (cols.hasLocalId) attempts.push({ where: 'm.local_id = ?', params: [numeric] })
      if (cols.hasServerId) attempts.push({ where: 'm.server_id = ?', params: [numeric] })
    }
    if (seq !== undefined && Number.isFinite(seq)) attempts.push({ where: '{seq} = ?', params: [seq] })
    for (const attempt of attempts) {
      const plan = buildSelect(ctx, ref, attempt.where, 'DESC', 1, attempt.params)
      let rows: Row[] = []
      try {
        rows = ctx.q.all(ref.dbPath, plan.sql, plan.params)
      } catch (error) {
        ctx.onShardError?.(ref.dbPath, error)
        continue
      }
      const row = rows[0]
      if (row) {
        const raw = readRawInfo(row)
        if (seq === undefined || deriveSeq(raw.sortSeq, raw.createTime, raw.localId) === seq) {
          return { row, raw, ref, myRowId: plan.myRowId }
        }
      }
    }
  }
  return undefined
}
