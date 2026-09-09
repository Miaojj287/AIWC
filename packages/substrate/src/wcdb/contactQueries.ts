/**
 * contact.db access: a lazily loaded in-memory directory of contacts (names, avatars, flags),
 * group member lists (chatroom_member ⋈ name2id) and best-effort group nicknames.
 */
import type { WxContact } from '@aiwc/protocol'
import {
  CONTACT_FLAG,
  classifyContactKind,
  isGroupUsername,
  pickAvatarUrl,
  pickDisplayName,
} from './accountUtils'
import { coerceRowNumber, decodeBlob, extractXmlValue, type Row } from './rowDecoders'
import { quoteIdent, type WcdbQuery } from './query'

export interface ContactRecord {
  username: string
  displayName: string
  remark?: string
  nickname?: string
  alias?: string
  avatarUrl?: string
  flag: number
  kind: WxContact['kind'] | null
}

const CONTACT_COLUMNS = ['username', 'remark', 'nick_name', 'alias', 'flag', 'local_type', 'type', 'big_head_url', 'small_head_url']
const PAGE = 2000

function toRecord(row: Row): ContactRecord | null {
  const username = String(row['username'] ?? '').trim()
  if (!username) return null
  const str = (key: string): string | undefined => {
    const value = row[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return {
    username,
    displayName: pickDisplayName(row, username),
    remark: str('remark'),
    nickname: str('nick_name'),
    alias: str('alias'),
    avatarUrl: pickAvatarUrl(row),
    flag: coerceRowNumber(row['flag'], 0),
    kind: classifyContactKind(username, row),
  }
}

export class ContactDirectory {
  private readonly records = new Map<string, ContactRecord>()
  private readonly missingRecords = new Set<string>()
  private readonly localAvatars = new Map<string, string | undefined>()
  private fullyLoaded = false
  private selectColumns: string[] | null = null
  private groupCounts: Map<string, number> | null = null
  private readonly groupNicknames = new Map<string, Map<string, string>>()
  private hasMemberTables: boolean | null = null

  constructor(
    private readonly q: WcdbQuery,
    private readonly contactDbPath: string | null,
    private readonly headImageDbPath: string | null = null,
  ) {}

  get available(): boolean {
    return !!this.contactDbPath
  }

  invalidate(): void {
    this.records.clear()
    this.localAvatars.clear()
    this.missingRecords.clear()
    this.fullyLoaded = false
    this.groupCounts = null
    this.groupNicknames.clear()
  }

  /** Full contact table (paged through rowid so a 50k-row table never lands in one native call). */
  all(): Map<string, ContactRecord> {
    if (this.fullyLoaded) return this.records
    if (this.contactDbPath && this.q.tableExists(this.contactDbPath, 'contact')) {
      const cols = this.columns().map(quoteIdent).join(', ')
      let lastRowId = 0
      for (;;) {
        const rows = this.q.all(
          this.contactDbPath,
          `SELECT rowid AS __rid, ${cols} FROM contact WHERE rowid > ? ORDER BY rowid ASC LIMIT ${PAGE}`,
          [lastRowId],
        )
        for (const row of rows) {
          const record = toRecord(row)
          if (record) this.records.set(record.username, record)
          lastRowId = Math.max(lastRowId, coerceRowNumber(row['__rid'], lastRowId))
        }
        if (rows.length < PAGE) break
      }
    }
    this.fullyLoaded = true
    return this.records
  }

  get(username: string): ContactRecord | undefined {
    const cached = this.records.get(username)
    if (cached || this.fullyLoaded || !username || this.missingRecords.has(username)) return cached
    this.preload([username])
    return this.records.get(username)
  }

  /** Load only the contacts needed by a visible session page. */
  preload(usernames: readonly string[]): void {
    if (this.fullyLoaded || !this.contactDbPath || !this.q.tableExists(this.contactDbPath, 'contact')) return
    const missing = [...new Set(usernames.filter((username) => username && !this.records.has(username) && !this.missingRecords.has(username)))]
    const cols = this.columns().map(quoteIdent).join(', ')
    for (let i = 0; i < missing.length; i += 400) {
      const batch = missing.slice(i, i + 400)
      const placeholders = batch.map(() => '?').join(', ')
      const rows = this.q.all(this.contactDbPath, `SELECT ${cols} FROM contact WHERE username IN (${placeholders})`, batch)
      const found = new Set<string>()
      for (const row of rows) {
        const record = toRecord(row)
        if (record) {
          this.records.set(record.username, record)
          found.add(record.username)
        }
      }
      for (const username of batch) if (!found.has(username)) this.missingRecords.add(username)
    }
  }

  displayName(username: string): string | undefined {
    return this.get(username)?.displayName
  }

  avatar(username: string): string | undefined {
    const remote = this.get(username)?.avatarUrl
    if (remote) return remote
    if (this.localAvatars.has(username)) return this.localAvatars.get(username)
    let avatar: string | undefined
    if (this.headImageDbPath) {
      try {
        const row = this.q.get(this.headImageDbPath, 'SELECT image_buffer FROM head_image WHERE username = ? LIMIT 1', [username])
        const bytes = decodeBlob(row?.['image_buffer'])
        if (bytes?.length) {
          const mime = bytes.subarray(0, 3).toString() === 'GIF' ? 'image/gif'
            : bytes[0] === 0x89 ? 'image/png'
            : bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg'
          avatar = `data:${mime};base64,${bytes.toString('base64')}`
        }
      } catch { /* Optional local avatar database may be unavailable. */ }
    }
    this.localAvatars.set(username, avatar)
    return avatar
  }

  isPinned(username: string): boolean {
    return ((this.get(username)?.flag ?? 0) & CONTACT_FLAG.PINNED) !== 0
  }

  /** Contacts as protocol objects; `lastContactAt` comes from the session table. */
  contacts(lastContactAt: ReadonlyMap<string, number>): WxContact[] {
    this.all()
    return this.toContacts(lastContactAt)
  }

  /** Full contact export with cooperative yields so session/message IPC remains responsive. */
  async contactsAsync(lastContactAt: ReadonlyMap<string, number>, yieldEvery: () => Promise<void>): Promise<WxContact[]> {
    if (!this.fullyLoaded && this.contactDbPath && this.q.tableExists(this.contactDbPath, 'contact')) {
      const cols = this.columns().map(quoteIdent).join(', ')
      let lastRowId = 0
      for (;;) {
        const rows = this.q.all(
          this.contactDbPath,
          `SELECT rowid AS __rid, ${cols} FROM contact WHERE rowid > ? ORDER BY rowid ASC LIMIT ${PAGE}`,
          [lastRowId],
        )
        for (const row of rows) {
          const record = toRecord(row)
          if (record) this.records.set(record.username, record)
          lastRowId = Math.max(lastRowId, coerceRowNumber(row['__rid'], lastRowId))
        }
        if (rows.length < PAGE) break
        await yieldEvery()
      }
      this.fullyLoaded = true
    }
    return this.toContacts(lastContactAt)
  }

  private toContacts(lastContactAt: ReadonlyMap<string, number>): WxContact[] {
    const list: WxContact[] = []
    for (const record of this.records.values()) {
      if (!record.kind) continue
      list.push({
        username: record.username,
        nickname: record.nickname ?? record.displayName,
        remark: record.remark,
        alias: record.alias,
        avatarPath: this.avatar(record.username),
        kind: record.kind,
        lastContactAt: lastContactAt.get(record.username),
      })
    }
    list.sort((a, b) => {
      const ta = a.lastContactAt ?? 0
      const tb = b.lastContactAt ?? 0
      if (ta !== tb) return tb - ta
      return (a.remark ?? a.nickname).localeCompare(b.remark ?? b.nickname, 'zh-CN')
    })
    return list
  }

  private memberTablesAvailable(): boolean {
    if (this.hasMemberTables !== null) return this.hasMemberTables
    this.hasMemberTables = false
    if (this.contactDbPath) {
      try {
        const names = new Set(this.q.tables(this.contactDbPath).map((n) => n.toLowerCase()))
        this.hasMemberTables = names.has('chatroom_member') && names.has('name2id')
      } catch {
        this.hasMemberTables = false
      }
    }
    return this.hasMemberTables
  }

  /** Member counts for every group in one query. */
  groupMemberCounts(): Map<string, number> {
    if (this.groupCounts) return this.groupCounts
    const counts = new Map<string, number>()
    if (this.contactDbPath && this.memberTablesAvailable()) {
      try {
        const rows = this.q.all(
          this.contactDbPath,
          `SELECT n.username AS username, COUNT(*) AS c FROM chatroom_member m JOIN name2id n ON m.room_id = n.rowid GROUP BY m.room_id`,
        )
        for (const row of rows) {
          const username = String(row['username'] ?? '')
          if (username) counts.set(username, coerceRowNumber(row['c'], 0))
        }
      } catch {
        // table shape differs; leave counts empty
      }
    }
    this.groupCounts = counts
    return counts
  }

  /** Group members with contact info; unknown members are 'stranger'. */
  groupMembers(groupId: string): WxContact[] {
    if (!this.contactDbPath || !isGroupUsername(groupId) || !this.memberTablesAvailable()) return []
    let rows: Row[] = []
    try {
      rows = this.q.all(
        this.contactDbPath,
        `SELECT n.username AS username FROM chatroom_member m JOIN name2id n ON m.member_id = n.rowid
         WHERE m.room_id = (SELECT rowid FROM name2id WHERE username = ?) ORDER BY m.rowid ASC`,
        [groupId],
      )
    } catch {
      return []
    }
    this.preload(rows.map((row) => String(row['username'] ?? '')))
    const nicknames = this.groupNicknamesOf(groupId)
    const members: WxContact[] = []
    for (const row of rows) {
      const username = String(row['username'] ?? '').trim()
      if (!username) continue
      const record = this.get(username)
      const groupNick = nicknames.get(username)
      members.push({
        username,
        nickname: record?.nickname ?? groupNick ?? record?.displayName ?? username,
        remark: record?.remark ?? (groupNick && groupNick !== record?.nickname ? groupNick : undefined),
        alias: record?.alias,
        avatarPath: this.avatar(username),
        kind: record?.kind && record.kind !== 'group' ? record.kind : 'stranger',
      })
    }
    return members
  }

  /** Display name for a sender inside a group: contact remark/nick → group nickname → username. */
  senderNameIn(groupId: string | undefined, username: string): string | undefined {
    const record = this.get(username)
    if (record) return record.displayName
    if (groupId && isGroupUsername(groupId)) return this.groupNicknamesOf(groupId).get(username)
    return undefined
  }

  /**
   * Group nicknames live in chatroom info blobs as `<member><username>..</username><displayName>..</displayName>`.
   * Table names differ between versions, so we probe `%chatroom%` tables that are not the member table.
   */
  groupNicknamesOf(groupId: string): Map<string, string> {
    const cached = this.groupNicknames.get(groupId)
    if (cached) return cached
    const result = new Map<string, string>()
    if (this.contactDbPath) {
      let tables: string[] = []
      try {
        tables = this.q.tables(this.contactDbPath, '%chatroom%').filter((n) => n.toLowerCase() !== 'chatroom_member')
      } catch {
        tables = []
      }
      for (const table of tables) {
        try {
          const cols = this.q.columns(this.contactDbPath, table)
          const keyCol = cols.find((c) => /^(username|chatroom_name|room_name)$/i.test(c))
          if (!keyCol) continue
          const rows = this.q.all(this.contactDbPath, `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(keyCol)} = ? LIMIT 1`, [groupId])
          for (const row of rows) {
            for (const value of Object.values(row)) {
              const text = typeof value === 'string' ? value : decodeBlob(value)?.toString('utf8')
              if (!text || !text.includes('<member>')) continue
              const memberRe = /<member>([\s\S]*?)<\/member>/gi
              let match: RegExpExecArray | null
              while ((match = memberRe.exec(text)) !== null) {
                const body = match[1] ?? ''
                const username = extractXmlValue(body, 'username')
                const displayName = extractXmlValue(body, 'displayName') || extractXmlValue(body, 'displayname')
                if (username && displayName) result.set(username, displayName)
              }
            }
          }
        } catch {
          // probe next table
        }
        if (result.size > 0) break
      }
    }
    this.groupNicknames.set(groupId, result)
    return result
  }

  private columns(): string[] {
    if (this.selectColumns) return this.selectColumns
    const actual = new Set(this.contactDbPath ? this.q.columns(this.contactDbPath, 'contact') : [])
    this.selectColumns = CONTACT_COLUMNS.filter((c) => actual.has(c))
    if (!this.selectColumns.includes('username')) this.selectColumns.unshift('username')
    return this.selectColumns
  }
}
