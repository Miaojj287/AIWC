/**
 * DemoSourceReader: SourceReader over a JSON fixture (dev / web mode and unit tests). Reads the file
 * lazily on open(), pages by seq, and answers querySql over an in-memory node:sqlite copy.
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { WxAccount, WxContact, WxMedia, WxMessage, WxSession } from '@aiwc/protocol'
import type { SourceOpenOptions, SourceReader } from '../source'
import { FixtureSchema, type Fixture, type NormalisedFixture } from './fixtureSchema'
import { contactKindFromUsername, sessionKindFromUsername } from '../normalize/kinds'
import { previewOf } from '../normalize/preview'
import { SubstrateError, errorMessage } from '../shared/errors'
import { guardSelectSql } from '../shared/sqlGuard'
import { Db } from '../mirror/db'

export interface DemoSourceOptions {
  fixturePath: string
  /** Inject a parsed fixture instead of reading `fixturePath` (tests). */
  fixture?: unknown
}

export function normaliseFixture(raw: unknown, baseDir: string): NormalisedFixture {
  const parsed = FixtureSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new SubstrateError('fixture_invalid', `演示数据格式错误：${issue ? `${issue.path.join('.')} ${issue.message}` : parsed.error.message}`)
  }
  const f: Fixture = parsed.data
  const resolvePath = (p: string | undefined): string | undefined => (p ? (isAbsolute(p) ? p : resolve(baseDir, p)) : undefined)

  const messages: WxMessage[] = f.messages.map((m) => {
    const media: WxMedia | undefined = m.media ? { ...m.media, path: resolvePath(m.media.path), thumbPath: resolvePath(m.media.thumbPath) } : undefined
    const out: WxMessage = {
      id: m.id,
      sessionId: m.sessionId,
      seq: m.seq,
      createdAt: m.createdAt,
      senderId: m.senderId,
      isSelf: m.isSelf,
      kind: m.kind,
      text: m.text,
      anchor: m.anchor ?? { sessionId: m.sessionId, messageId: m.id, seq: m.seq, createdAt: m.createdAt },
    }
    if (m.senderName) out.senderName = m.senderName
    if (media) out.media = media
    if (m.quote) out.quote = m.quote
    return out
  })
  messages.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : a.seq - b.seq))

  const latestBySession = new Map<string, WxMessage>()
  for (const m of messages) {
    const cur = latestBySession.get(m.sessionId)
    if (!cur || m.createdAt >= cur.createdAt) latestBySession.set(m.sessionId, m)
  }

  const sessions: WxSession[] = f.sessions.map((s) => {
    const latest = latestBySession.get(s.id)
    const out: WxSession = {
      id: s.id,
      kind: s.kind ?? sessionKindFromUsername(s.id),
      title: s.title || s.id,
      unread: s.unread,
      pinned: s.pinned,
      muted: s.muted,
    }
    const avatar = resolvePath(s.avatarPath)
    if (avatar) out.avatarPath = avatar
    const lastAt = s.lastMessageAt ?? latest?.createdAt
    if (lastAt) out.lastMessageAt = lastAt
    const preview = s.lastPreview ?? (latest ? previewOf(latest) : undefined)
    if (preview) out.lastPreview = preview
    const sender = s.lastSender ?? latest?.senderName ?? latest?.senderId
    if (sender) out.lastSender = sender
    const members = f.groupMembers[s.id]
    const memberCount = s.memberCount ?? (members ? members.length : undefined)
    if (memberCount !== undefined) out.memberCount = memberCount
    return out
  })

  const contacts: WxContact[] = f.contacts.map((c) => {
    const out: WxContact = { username: c.username, nickname: c.nickname || c.username, kind: c.kind ?? contactKindFromUsername(c.username) }
    if (c.remark) out.remark = c.remark
    if (c.alias) out.alias = c.alias
    const avatar = resolvePath(c.avatarPath)
    if (avatar) out.avatarPath = avatar
    if (c.lastContactAt) out.lastContactAt = c.lastContactAt
    return out
  })

  const account: WxAccount = { wxid: f.account.wxid, dbRoot: f.account.dbRoot || baseDir, verified: f.account.verified }
  if (f.account.nickname) account.nickname = f.account.nickname
  const accountAvatar = resolvePath(f.account.avatarPath)
  if (accountAvatar) account.avatarPath = accountAvatar

  return { account, sessions, contacts, groupMembers: f.groupMembers, messages }
}

function buildSqlCopy(fx: NormalisedFixture): Db {
  const db = new Db(':memory:')
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, kind TEXT, title TEXT, last_message_at INTEGER, last_preview TEXT, unread INTEGER, pinned INTEGER, muted INTEGER, member_count INTEGER);
    CREATE TABLE contacts (username TEXT PRIMARY KEY, nickname TEXT, remark TEXT, alias TEXT, kind TEXT, last_contact_at INTEGER);
    CREATE TABLE group_members (group_id TEXT, username TEXT, PRIMARY KEY (group_id, username));
    CREATE TABLE messages (id TEXT, session_id TEXT, seq INTEGER, created_at INTEGER, sender_id TEXT, sender_name TEXT, is_self INTEGER, kind TEXT, text TEXT, PRIMARY KEY (session_id, id));
    CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
  `)
  db.tx(() => {
    for (const s of fx.sessions) {
      db.run('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', s.id, s.kind, s.title, s.lastMessageAt ?? null, s.lastPreview ?? null, s.unread, s.pinned ? 1 : 0, s.muted ? 1 : 0, s.memberCount ?? null)
    }
    for (const c of fx.contacts) {
      db.run('INSERT OR REPLACE INTO contacts VALUES (?, ?, ?, ?, ?, ?)', c.username, c.nickname, c.remark ?? null, c.alias ?? null, c.kind, c.lastContactAt ?? null)
    }
    for (const [groupId, members] of Object.entries(fx.groupMembers)) {
      for (const u of members) db.run('INSERT OR IGNORE INTO group_members VALUES (?, ?)', groupId, u)
    }
    for (const m of fx.messages) {
      db.run('INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', m.id, m.sessionId, m.seq, m.createdAt, m.senderId, m.senderName ?? null, m.isSelf ? 1 : 0, m.kind, m.text)
    }
  })
  return db
}

export function createDemoSourceReader(opts: DemoSourceOptions): SourceReader {
  let fixture: NormalisedFixture | undefined
  let bySession: Map<string, WxMessage[]> | undefined
  let sqlDb: Db | undefined
  let openOpts: SourceOpenOptions | undefined

  const requireOpen = (): NormalisedFixture => {
    if (!fixture) throw new SubstrateError('not_open', '演示数据尚未打开')
    return fixture
  }

  const load = async (): Promise<NormalisedFixture> => {
    const baseDir = dirname(resolve(opts.fixturePath))
    if (opts.fixture !== undefined) return normaliseFixture(opts.fixture, baseDir)
    let text: string
    try {
      text = await readFile(opts.fixturePath, 'utf8')
    } catch (err) {
      throw new SubstrateError('io', `读取演示数据失败：${errorMessage(err)}`, { cause: err })
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      throw new SubstrateError('fixture_invalid', `演示数据不是合法 JSON：${errorMessage(err)}`, { cause: err })
    }
    return normaliseFixture(json, baseDir)
  }

  const index = (fx: NormalisedFixture): Map<string, WxMessage[]> => {
    const map = new Map<string, WxMessage[]>()
    for (const m of fx.messages) {
      const list = map.get(m.sessionId)
      if (list) list.push(m)
      else map.set(m.sessionId, [m])
    }
    return map
  }

  const listFor = (sessionId: string): WxMessage[] => {
    requireOpen()
    return bySession?.get(sessionId) ?? []
  }

  return {
    kind: 'demo',

    async open(o) {
      openOpts = o
      fixture = await load()
      bySession = index(fixture)
      sqlDb?.close()
      sqlDb = undefined
    },

    async close() {
      fixture = undefined
      bySession = undefined
      openOpts = undefined
      sqlDb?.close()
      sqlDb = undefined
    },

    isOpen: () => fixture !== undefined,

    async account() {
      const fx = requireOpen()
      const wxid = openOpts?.wxid || fx.account.wxid
      return { ...fx.account, wxid, dbRoot: openOpts?.dbRoot || fx.account.dbRoot }
    },

    async sessions() {
      return requireOpen().sessions.map((s) => ({ ...s }))
    },

    async contacts() {
      return requireOpen().contacts.map((c) => ({ ...c }))
    },

    async groupMembers(groupId) {
      const fx = requireOpen()
      const usernames = fx.groupMembers[groupId] ?? []
      const byName = new Map(fx.contacts.map((c) => [c.username, c] as const))
      return usernames.map((u) => byName.get(u) ?? { username: u, nickname: u, kind: 'stranger' as const })
    },

    async messagesAfter(sessionId, afterSeq, limit) {
      const list = listFor(sessionId)
      const out: WxMessage[] = []
      for (const m of list) {
        if (m.seq > afterSeq) {
          out.push(m)
          if (out.length >= limit) break
        }
      }
      return out
    },

    async messagesBefore(sessionId, beforeSeq, limit) {
      const list = listFor(sessionId)
      const out: WxMessage[] = []
      for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
        const m = list[i]
        if (m && m.seq < beforeSeq) out.push(m)
      }
      return out
    },

    async resolveMedia(message) {
      requireOpen()
      const found = bySession?.get(message.sessionId)?.find((m) => m.id === message.id)
      return (found ?? message).media
    },

    watch() {
      return () => {}
    },

    async querySql(_db, sql, limit) {
      const fx = requireOpen()
      const guarded = guardSelectSql(sql, limit)
      sqlDb ??= buildSqlCopy(fx)
      try {
        const stmt = sqlDb.raw.prepare(guarded.sql)
        const columns = stmt.columns().map((c) => c.name)
        stmt.setReturnArrays(true)
        const rows = stmt.all() as unknown as unknown[][]
        return { columns, rows }
      } catch (err) {
        if (err instanceof SubstrateError) throw err
        throw new SubstrateError('sql_rejected', `SQL 执行失败：${errorMessage(err)}`, { cause: err })
      }
    },
  }
}
