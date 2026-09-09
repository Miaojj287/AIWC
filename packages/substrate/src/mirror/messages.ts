import type { ListMessagesQuery, MessageAnchor, WxMedia, WxMessage } from '@aiwc/protocol'
import { type Db, type SqlParam, num, placeholders } from './db'
import { type MessageRow, rowToMessage } from './rows'
import type { InsertResult } from './types'
import { sessionKindFromUsername } from '../normalize/kinds'
import { previewOf } from '../normalize/preview'
import { nowMs } from '../shared/time'

export interface MessageOps {
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
  removeSession(sessionId: string): void
  transcripts: {
    get(sessionId: string, messageId: string): string | undefined
    set(sessionId: string, messageId: string, text: string): void
  }
  audit(sql: string, reason: string, rows: number): void
  auditLog(limit?: number): Array<{ at: number; sql: string; reason: string; rows: number }>
}

const MESSAGE_COLUMNS = 'id, session_id, msg_id, seq, created_at, sender_id, sender_name, is_self, kind, text, media_json, quote_json, presentation_json'

export function createMessageOps(db: Db): MessageOps {
  const insertSql = `INSERT OR IGNORE INTO messages (session_id, msg_id, seq, created_at, sender_id, sender_name, is_self, kind, text, media_json, quote_json, presentation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

  const refreshSessionCounters = (sessionId: string) => {
    db.run(
      `UPDATE sessions SET
         indexed_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?),
         indexed_until = (SELECT MAX(created_at) FROM messages WHERE session_id = ?)
       WHERE id = ?`,
      sessionId,
      sessionId,
      sessionId,
    )
  }

  const setWatermark = (sessionId: string, seq: number, indexedUntil?: number) => {
    db.run('INSERT OR IGNORE INTO sessions (id, kind, title) VALUES (?, ?, ?)', sessionId, sessionKindFromUsername(sessionId), sessionId)
    db.run(
      `UPDATE sessions SET watermark_seq = MAX(watermark_seq, ?), indexed_until = MAX(COALESCE(indexed_until, 0), COALESCE(?, 0)) WHERE id = ?`,
      Math.max(0, Math.floor(seq)),
      indexedUntil ?? null,
      sessionId,
    )
  }

  const messageFilters = (q: ListMessagesQuery): { clauses: string[]; params: SqlParam[] } => {
    const clauses = ['session_id = ?']
    const params: SqlParam[] = [q.sessionId]
    if (q.from !== undefined) {
      clauses.push('created_at >= ?')
      params.push(q.from)
    }
    if (q.to !== undefined) {
      clauses.push('created_at <= ?')
      params.push(q.to)
    }
    if (q.senderIds?.length) {
      clauses.push(`sender_id IN (${placeholders(q.senderIds.length)})`)
      params.push(...q.senderIds)
    }
    if (q.kinds?.length) {
      clauses.push(`kind IN (${placeholders(q.kinds.length)})`)
      params.push(...q.kinds)
    }
    return { clauses, params }
  }

  return {
    insertMessages(messages, options) {
      if (!messages.length) return { inserted: 0, changedSessions: [] }
      type Latest = { inserted: number; maxSeq: number; latest?: WxMessage }
      const perSession = new Map<string, Latest>()
      db.tx(() => {
        for (const m of messages) {
          const qualified = /^wx:(\d+):(\d+)$/.exec(m.id)
          if (qualified) {
            // Upgrade only the identical old row. A reused local_id with another seq is a
            // different message and must be inserted, never overwritten or ignored.
            const legacy = db.get<{ msg_id: string }>('SELECT msg_id FROM messages WHERE session_id = ? AND msg_id = ? AND seq = ?', m.sessionId, qualified[1]!, m.seq)
            if (legacy) {
              db.run('UPDATE messages SET msg_id = ? WHERE session_id = ? AND msg_id = ?', m.id, m.sessionId, legacy.msg_id)
              db.run('UPDATE voice_transcripts SET msg_id = ? WHERE session_id = ? AND msg_id = ?', m.id, m.sessionId, legacy.msg_id)
            }
          }
          const r = db.run(
            insertSql,
            m.sessionId,
            m.id,
            m.seq,
            m.createdAt,
            m.senderId ?? '',
            m.senderName ?? null,
            m.isSelf ? 1 : 0,
            m.kind,
            m.text ?? '',
            m.media ? JSON.stringify(m.media) : null,
            m.quote ? JSON.stringify(m.quote) : null,
            m.presentationVersion ? JSON.stringify({ rich: m.rich, presentationVersion: m.presentationVersion }) : null,
          )
          // Re-reading a page upgrades old presentation without discarding decrypted media,
          // transcripts, watermarks, or counting an existing message as newly inserted.
          if (r.changes === 0 && m.presentationVersion) {
            db.run(`UPDATE messages SET kind = ?, text = ?, quote_json = ?, presentation_json = ?
              WHERE session_id = ? AND msg_id = ? AND COALESCE(presentation_json, '') != ?`,
              m.kind, m.text, m.quote ? JSON.stringify(m.quote) : null,
              JSON.stringify({ rich: m.rich, presentationVersion: m.presentationVersion }), m.sessionId, m.id,
              JSON.stringify({ rich: m.rich, presentationVersion: m.presentationVersion }))
          }
          if (r.changes > 0) {
            const cur = perSession.get(m.sessionId) ?? { inserted: 0, maxSeq: -Infinity }
            cur.inserted++
            cur.maxSeq = Math.max(cur.maxSeq, m.seq)
            if (!cur.latest || m.createdAt >= cur.latest.createdAt) cur.latest = m
            perSession.set(m.sessionId, cur)
          }
        }
        for (const [sessionId, info] of perSession) {
          setWatermark(sessionId, options?.advanceWatermark === false ? 0 : info.maxSeq, info.latest?.createdAt)
          refreshSessionCounters(sessionId)
          if (info.latest) {
            db.run(
              `UPDATE sessions SET last_message_at = ?, last_preview = ?, last_sender = ?
               WHERE id = ? AND COALESCE(last_message_at, 0) <= ?`,
              info.latest.createdAt,
              previewOf(info.latest),
              info.latest.senderName ?? info.latest.senderId,
              sessionId,
              info.latest.createdAt,
            )
          }
        }
      })
      let inserted = 0
      for (const v of perSession.values()) inserted += v.inserted
      return { inserted, changedSessions: [...perSession.keys()] }
    },

    watermark(sessionId) {
      return num(db.get<{ w: number }>('SELECT watermark_seq AS w FROM sessions WHERE id = ?', sessionId)?.w)
    },

    setWatermark,

    listMessages(q) {
      const limit = Math.max(1, Math.floor(q.limit || 50))
      const { clauses, params } = messageFilters(q)
      let order: 'ASC' | 'DESC' = 'DESC'
      if (q.afterSeq !== undefined) {
        clauses.push('seq > ?')
        params.push(q.afterSeq)
        order = 'ASC'
      } else if (q.beforeSeq !== undefined) {
        clauses.push('seq < ?')
        params.push(q.beforeSeq)
      }
      const rows = db.all<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${clauses.join(' AND ')} ORDER BY seq ${order} LIMIT ?`,
        ...params,
        limit + 1,
      )
      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      if (order === 'DESC') page.reverse()
      return { items: page.map(rowToMessage), hasMore }
    },

    getMessage(sessionId, messageId) {
      const row = db.get<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND msg_id = ?`, sessionId, messageId)
      return row ? rowToMessage(row) : undefined
    },

    getMessageBySeq(sessionId, seq) {
      const row = db.get<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND seq = ? LIMIT 1`, sessionId, seq)
      return row ? rowToMessage(row) : undefined
    },

    getContext(anchor, radius) {
      const r = Math.max(0, Math.floor(radius))
      const before = db.all<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
        anchor.sessionId,
        anchor.seq,
        r,
      )
      const at = db.all<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND (msg_id = ? OR seq = ?) ORDER BY seq ASC`, anchor.sessionId, anchor.messageId, anchor.seq)
      const after = db.all<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
        anchor.sessionId,
        anchor.seq,
        r,
      )
      const seen = new Set<string>()
      const out: WxMessage[] = []
      for (const row of [...before.reverse(), ...at, ...after]) {
        if (seen.has(row.msg_id)) continue
        seen.add(row.msg_id)
        out.push(rowToMessage(row))
      }
      return out
    },

    oldestSeq(sessionId) {
      const v = db.get<{ s: number | null }>('SELECT MIN(seq) AS s FROM messages WHERE session_id = ?', sessionId)?.s
      return v === null || v === undefined ? undefined : num(v)
    },

    newestSeq(sessionId) {
      const v = db.get<{ s: number | null }>('SELECT MAX(seq) AS s FROM messages WHERE session_id = ?', sessionId)?.s
      return v === null || v === undefined ? undefined : num(v)
    },

    countMessages(sessionId) {
      if (sessionId) return num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM messages WHERE session_id = ?', sessionId)?.c)
      return num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM messages')?.c)
    },

    updateMedia(sessionId, messageId, media) {
      db.run('UPDATE messages SET media_json = ? WHERE session_id = ? AND msg_id = ?', media ? JSON.stringify(media) : null, sessionId, messageId)
    },

    removeSession(sessionId) {
      db.tx(() => {
        db.run('DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE session_id = ?)', sessionId)
        db.run('DELETE FROM chunks WHERE session_id = ?', sessionId)
        db.run('DELETE FROM voice_transcripts WHERE session_id = ?', sessionId)
        db.run('DELETE FROM messages WHERE session_id = ?', sessionId)
        db.run('UPDATE sessions SET watermark_seq = 0, indexed_count = 0, indexed_until = NULL WHERE id = ?', sessionId)
      })
    },

    transcripts: {
      get(sessionId, messageId) {
        return db.get<{ text: string }>('SELECT text FROM voice_transcripts WHERE session_id = ? AND msg_id = ?', sessionId, messageId)?.text
      },
      set(sessionId, messageId, text) {
        db.run('INSERT OR REPLACE INTO voice_transcripts (session_id, msg_id, text, created_at) VALUES (?, ?, ?, ?)', sessionId, messageId, text, nowMs())
      },
    },

    audit(sql, reason, rows) {
      db.run('INSERT INTO sql_audit (at, sql, reason, rows) VALUES (?, ?, ?, ?)', nowMs(), sql, reason, rows)
    },

    auditLog(limit = 50) {
      const rows = db.all<{ at: number; sql: string; reason: string | null; rows: number | null }>(
        'SELECT at, sql, reason, rows FROM sql_audit ORDER BY id DESC LIMIT ?',
        Math.max(1, Math.floor(limit)),
      )
      return rows.map((r) => ({ at: num(r.at), sql: r.sql, reason: r.reason ?? '', rows: num(r.rows) }))
    },
  }
}
