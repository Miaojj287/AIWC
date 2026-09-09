import type { ListSessionsQuery, PageRequest, WxContact, WxSession } from '@aiwc/protocol'
import { type Db, type SqlParam, num } from './db'
import { type ContactRow, type SessionRow, rowToContact, rowToSession } from './rows'
import type { GroupMemberInput, ListContactsQuery, SessionFlags } from './types'
import { nowMs } from '../shared/time'

const SESSION_ORDER = 'ORDER BY COALESCE(pinned_local, pinned) DESC, COALESCE(last_message_at, 0) DESC, id ASC'

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export interface SessionOps {
  upsertSessions(sessions: readonly WxSession[]): void
  getSession(id: string): WxSession | undefined
  listSessions(q: ListSessionsQuery): { items: WxSession[]; total: number; hasMore: boolean }
  setSessionFlags(sessionId: string, flags: SessionFlags): void
  ensureSessionRow(id: string, kind: string, title?: string): void
  upsertContacts(contacts: readonly WxContact[]): void
  getContact(username: string): WxContact | undefined
  listContacts(q: ListContactsQuery): { items: WxContact[]; total: number }
  upsertGroupMembers(groupId: string, members: readonly GroupMemberInput[]): void
  listGroupMembers(groupId: string, q?: PageRequest): { items: WxContact[]; total: number }
  hasGroupMembers(groupId: string): boolean
}

export function createSessionOps(db: Db): SessionOps {
  const upsertSessionSql = `
    INSERT INTO sessions (id, kind, title, avatar_path, last_message_at, last_preview, last_sender, unread, member_count, pinned, muted, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      avatar_path = COALESCE(excluded.avatar_path, sessions.avatar_path),
      last_message_at = CASE WHEN COALESCE(excluded.last_message_at, 0) >= COALESCE(sessions.last_message_at, 0) THEN excluded.last_message_at ELSE sessions.last_message_at END,
      last_preview = CASE WHEN COALESCE(excluded.last_message_at, 0) >= COALESCE(sessions.last_message_at, 0) AND excluded.last_preview IS NOT NULL THEN excluded.last_preview ELSE sessions.last_preview END,
      last_sender = CASE WHEN COALESCE(excluded.last_message_at, 0) >= COALESCE(sessions.last_message_at, 0) AND excluded.last_sender IS NOT NULL THEN excluded.last_sender ELSE sessions.last_sender END,
      unread = excluded.unread,
      member_count = COALESCE(excluded.member_count, sessions.member_count),
      pinned = excluded.pinned,
      muted = excluded.muted,
      collapsed = excluded.collapsed`

  const upsertContactSql = `
    INSERT INTO contacts (username, nickname, remark, alias, avatar_path, kind, last_contact_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      nickname = excluded.nickname,
      remark = excluded.remark,
      alias = excluded.alias,
      avatar_path = COALESCE(excluded.avatar_path, contacts.avatar_path),
      kind = excluded.kind,
      last_contact_at = COALESCE(excluded.last_contact_at, contacts.last_contact_at)`

  const sessionWhere = (q: ListSessionsQuery): { where: string; params: SqlParam[] } => {
    const clauses: string[] = []
    const params: SqlParam[] = []
    if (q.kind && q.kind !== 'all') {
      clauses.push('kind = ?')
      params.push(q.kind)
    }
    if (!q.includeHidden) clauses.push('hidden = 0')
    if (q.unreadOnly) clauses.push('unread > 0')
    const query = q.query?.trim()
    if (query) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR last_preview LIKE ? ESCAPE '\\')")
      const p = likePattern(query)
      params.push(p, p, p)
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
  }

  const contactWhere = (q: ListContactsQuery): { where: string; params: SqlParam[] } => {
    const clauses: string[] = []
    const params: SqlParam[] = []
    if (q.kind && q.kind !== 'all') {
      clauses.push('kind = ?')
      params.push(q.kind)
    }
    const query = q.query?.trim()
    if (query) {
      clauses.push("(nickname LIKE ? ESCAPE '\\' OR remark LIKE ? ESCAPE '\\' OR alias LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')")
      const p = likePattern(query)
      params.push(p, p, p, p)
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
  }

  return {
    upsertSessions(sessions) {
      if (!sessions.length) return
      db.tx(() => {
        for (const s of sessions) {
          db.run(
            upsertSessionSql,
            s.id,
            s.kind,
            s.title ?? '',
            s.avatarPath ?? null,
            s.lastMessageAt ?? null,
            s.lastPreview ?? null,
            s.lastSender ?? null,
            s.unread ?? 0,
            s.memberCount ?? null,
            s.pinned ? 1 : 0,
            s.muted ? 1 : 0,
            s.collapsed ? 1 : 0,
          )
        }
      })
    },

    ensureSessionRow(id, kind, title) {
      db.run('INSERT OR IGNORE INTO sessions (id, kind, title) VALUES (?, ?, ?)', id, kind, title ?? id)
    },

    getSession(id) {
      const row = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)
      return row ? rowToSession(row) : undefined
    },

    listSessions(q) {
      const { where, params } = sessionWhere(q)
      const limit = Math.max(1, Math.floor(q.limit || 50))
      const offset = Math.max(0, Math.floor(q.offset ?? 0))
      const total = num(db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM sessions ${where}`, ...params)?.c)
      const rows = db.all<SessionRow>(`SELECT * FROM sessions ${where} ${SESSION_ORDER} LIMIT ? OFFSET ?`, ...params, limit, offset)
      const items = rows.map(rowToSession)
      return { items, total, hasMore: offset + items.length < total }
    },

    setSessionFlags(sessionId, flags) {
      const sets: string[] = []
      const params: SqlParam[] = []
      if (flags.pinned !== undefined) {
        sets.push('pinned_local = ?')
        params.push(flags.pinned ? 1 : 0)
      }
      if (flags.muted !== undefined) {
        sets.push('muted_local = ?')
        params.push(flags.muted ? 1 : 0)
      }
      if (flags.hidden !== undefined) {
        sets.push('hidden = ?', 'hidden_at = ?')
        params.push(flags.hidden ? 1 : 0, flags.hidden ? nowMs() : null)
      }
      if (flags.read) sets.push('unread = 0')
      if (!sets.length) return
      db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, ...params, sessionId)
    },

    upsertContacts(contacts) {
      if (!contacts.length) return
      db.tx(() => {
        for (const c of contacts) {
          db.run(upsertContactSql, c.username, c.nickname ?? '', c.remark ?? null, c.alias ?? null, c.avatarPath ?? null, c.kind, c.lastContactAt ?? null)
        }
      })
    },

    getContact(username) {
      const row = db.get<ContactRow>('SELECT * FROM contacts WHERE username = ?', username)
      return row ? rowToContact(row) : undefined
    },

    listContacts(q) {
      const { where, params } = contactWhere(q)
      const limit = Math.max(1, Math.floor(q.limit || 50))
      const offset = Math.max(0, Math.floor(q.offset ?? 0))
      const total = num(db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM contacts ${where}`, ...params)?.c)
      const rows = db.all<ContactRow>(
        `SELECT * FROM contacts ${where} ORDER BY COALESCE(NULLIF(remark, ''), NULLIF(nickname, ''), username) COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      )
      return { items: rows.map(rowToContact), total }
    },

    upsertGroupMembers(groupId, members) {
      db.tx(() => {
        db.run('DELETE FROM group_members WHERE group_id = ?', groupId)
        for (const m of members) {
          if (!m.username) continue
          db.run('INSERT OR REPLACE INTO group_members (group_id, username, display_name) VALUES (?, ?, ?)', groupId, m.username, m.displayName ?? null)
        }
        db.run('UPDATE sessions SET member_count = ? WHERE id = ?', members.length, groupId)
      })
    },

    hasGroupMembers(groupId) {
      return num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', groupId)?.c) > 0
    },

    listGroupMembers(groupId, q) {
      const limit = Math.max(1, Math.floor(q?.limit || 500))
      const offset = Math.max(0, Math.floor(q?.offset ?? 0))
      const total = num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', groupId)?.c)
      const rows = db.all<ContactRow & { display_name: string | null; has_contact: number }>(
        `SELECT gm.username AS username,
                COALESCE(NULLIF(c.nickname, ''), NULLIF(gm.display_name, ''), gm.username) AS nickname,
                c.remark AS remark, c.alias AS alias, c.avatar_path AS avatar_path,
                COALESCE(c.kind, 'stranger') AS kind, c.last_contact_at AS last_contact_at,
                gm.display_name AS display_name,
                CASE WHEN c.username IS NULL THEN 0 ELSE 1 END AS has_contact
         FROM group_members gm LEFT JOIN contacts c ON c.username = gm.username
         WHERE gm.group_id = ?
         ORDER BY COALESCE(NULLIF(c.remark, ''), NULLIF(gm.display_name, ''), NULLIF(c.nickname, ''), gm.username) COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
        groupId,
        limit,
        offset,
      )
      const items = rows.map((r) => {
        const c = rowToContact(r)
        if (r.display_name && !c.remark && r.display_name !== c.nickname) c.remark = r.display_name
        return c
      })
      return { items, total }
    },
  }
}
