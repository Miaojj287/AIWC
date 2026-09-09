/**
 * Auto-reply persistence on node:sqlite: rules (one per session), records (audit trail of every
 * outbound decision) and drafts (the reply desk, so pending confirmations survive a restart).
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_HISTORY_COUNT, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT, type AutoReplyRecord, type AutoReplyRule, type DraftState, type ReplyDraft, type ReplyRecordStatus } from '@aiwc/protocol'

export interface RecordQuery {
  sessionId?: string
  status?: ReplyRecordStatus
  limit?: number
}

export interface AutoReplyRecordStore {
  listRules(): AutoReplyRule[]
  getRule(sessionId: string): AutoReplyRule | undefined
  getRuleById(id: string): AutoReplyRule | undefined
  saveRule(rule: AutoReplyRule): AutoReplyRule
  setEnabled(sessionId: string, enabled: boolean): void
  deleteRule(sessionId: string): void

  listRecords(q?: RecordQuery): AutoReplyRecord[]
  getRecord(id: string): AutoReplyRecord | undefined
  addRecord(record: AutoReplyRecord): void
  updateRecord(id: string, patch: Partial<Omit<AutoReplyRecord, 'id'>>): AutoReplyRecord | undefined
  /** Replies actually sent today (local midnight → now) for a session. */
  countToday(sessionId: string, now?: number): number

  listDrafts(states?: readonly DraftState[]): ReplyDraft[]
  getDraft(id: string): ReplyDraft | undefined
  saveDraft(draft: ReplyDraft): void
  deleteDraft(id: string): void

  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_session_at ON records(session_id, at DESC);
CREATE INDEX IF NOT EXISTS records_status_at ON records(status, at DESC);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_state_created ON drafts(state, created_at DESC);
`

function localMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Strip derived fields before persisting a rule. */
function stripDerived(rule: AutoReplyRule): AutoReplyRule {
  const { todayCount: _todayCount, ...rest } = rule
  return rest
}

/**
 * Rules are stored as JSON, so rows written by an older build still carry the fields the rule model
 * used to have (trigger / schedule / style / persona / confirmBeforeSend). Read them back as the
 * current shape — a half-typed rule reaching the gate is how a chat silently stops replying.
 */
export function normaliseStoredRule(input: AutoReplyRule): AutoReplyRule {
  const raw = input as AutoReplyRule & Record<string, unknown>
  const legacyDeep = raw.deep === true ? 120 : DEFAULT_HISTORY_COUNT
  const n = Math.round(Number(raw.historyCount ?? legacyDeep))
  return {
    id: String(raw.id ?? ''),
    sessionId: String(raw.sessionId ?? ''),
    accountId: typeof raw.accountId === 'string' ? raw.accountId : undefined,
    enabled: Boolean(raw.enabled),
    // 'handoff' rules no longer exist; they became AI replies rather than silently doing nothing.
    source: raw.source === 'fixed' ? 'fixed' : 'ai',
    fixedText: typeof raw.fixedText === 'string' && raw.fixedText.trim() ? raw.fixedText : undefined,
    prompt: typeof raw.prompt === 'string' && raw.prompt.trim() ? raw.prompt : undefined,
    historyCount: Number.isFinite(n) ? Math.max(MIN_HISTORY_COUNT, Math.min(MAX_HISTORY_COUNT, n)) : DEFAULT_HISTORY_COUNT,
    updatedAt: Number(raw.updatedAt) || 0,
    pausedReason: typeof raw.pausedReason === 'string' ? raw.pausedReason : undefined,
  }
}

export function createAutoReplyRecordStore(opts: { dbPath: string }): AutoReplyRecordStore {
  if (opts.dbPath !== ':memory:') mkdirSync(dirname(opts.dbPath), { recursive: true })
  const db = new DatabaseSync(opts.dbPath)
  if (opts.dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  const stmts = {
    listRules: db.prepare('SELECT json FROM rules ORDER BY updated_at DESC'),
    getRule: db.prepare('SELECT json FROM rules WHERE session_id = ?'),
    getRuleById: db.prepare('SELECT json FROM rules WHERE id = ?'),
    upsertRule: db.prepare(
      'INSERT INTO rules (id, session_id, enabled, updated_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET id = excluded.id, enabled = excluded.enabled, updated_at = excluded.updated_at, json = excluded.json',
    ),
    deleteRule: db.prepare('DELETE FROM rules WHERE session_id = ?'),
    getRecord: db.prepare('SELECT json FROM records WHERE id = ?'),
    insertRecord: db.prepare('INSERT INTO records (id, rule_id, session_id, at, status, json) VALUES (?, ?, ?, ?, ?, ?)'),
    updateRecord: db.prepare('UPDATE records SET rule_id = ?, session_id = ?, at = ?, status = ?, json = ? WHERE id = ?'),
    countToday: db.prepare("SELECT COUNT(*) AS n FROM records WHERE session_id = ? AND status = 'sent' AND at >= ?"),
    listDraftsAll: db.prepare('SELECT json FROM drafts ORDER BY created_at DESC'),
    getDraft: db.prepare('SELECT json FROM drafts WHERE id = ?'),
    upsertDraft: db.prepare('INSERT INTO drafts (id, state, created_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, created_at = excluded.created_at, json = excluded.json'),
    deleteDraft: db.prepare('DELETE FROM drafts WHERE id = ?'),
  }

  const parseRows = <T>(rows: unknown[]): T[] => rows.map((r) => JSON.parse(String((r as { json: string }).json)) as T)
  const parseOne = <T>(row: unknown): T | undefined => (row ? (JSON.parse(String((row as { json: string }).json)) as T) : undefined)

  const store: AutoReplyRecordStore = {
    listRules() {
      const rules = parseRows<AutoReplyRule>(stmts.listRules.all()).map(normaliseStoredRule)
      return rules.map((r) => ({ ...r, todayCount: store.countToday(r.sessionId) }))
    },
    getRule(sessionId) {
      const rule = parseOne<AutoReplyRule>(stmts.getRule.get(sessionId))
      return rule ? { ...normaliseStoredRule(rule), todayCount: store.countToday(sessionId) } : undefined
    },
    getRuleById(id) {
      const rule = parseOne<AutoReplyRule>(stmts.getRuleById.get(id))
      return rule ? normaliseStoredRule(rule) : undefined
    },
    saveRule(rule) {
      const saved = stripDerived({ ...rule, updatedAt: rule.updatedAt || Date.now() })
      stmts.upsertRule.run(saved.id, saved.sessionId, saved.enabled ? 1 : 0, saved.updatedAt, JSON.stringify(saved))
      return { ...saved, todayCount: store.countToday(saved.sessionId) }
    },
    setEnabled(sessionId, enabled) {
      const rule = store.getRule(sessionId)
      if (!rule) return
      store.saveRule({ ...rule, enabled, pausedReason: enabled ? undefined : rule.pausedReason, updatedAt: Date.now() })
    },
    deleteRule(sessionId) {
      stmts.deleteRule.run(sessionId)
    },

    listRecords(q = {}) {
      const where: string[] = []
      const params: Array<string | number> = []
      if (q.sessionId) {
        where.push('session_id = ?')
        params.push(q.sessionId)
      }
      if (q.status) {
        where.push('status = ?')
        params.push(q.status)
      }
      const limit = Math.max(1, Math.min(q.limit ?? 100, 1000))
      const sql = `SELECT json FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`
      return parseRows<AutoReplyRecord>(db.prepare(sql).all(...params, limit))
    },
    getRecord(id) {
      return parseOne<AutoReplyRecord>(stmts.getRecord.get(id))
    },
    addRecord(record) {
      stmts.insertRecord.run(record.id, record.ruleId, record.sessionId, record.at, record.status, JSON.stringify(record))
    },
    updateRecord(id, patch) {
      const current = store.getRecord(id)
      if (!current) return undefined
      const next: AutoReplyRecord = { ...current, ...patch, id }
      stmts.updateRecord.run(next.ruleId, next.sessionId, next.at, next.status, JSON.stringify(next), id)
      return next
    },
    countToday(sessionId, now = Date.now()) {
      const row = stmts.countToday.get(sessionId, localMidnight(now)) as { n: number | bigint } | undefined
      return Number(row?.n ?? 0)
    },

    listDrafts(states) {
      const drafts = parseRows<ReplyDraft>(stmts.listDraftsAll.all())
      return states ? drafts.filter((d) => states.includes(d.state)) : drafts
    },
    getDraft(id) {
      return parseOne<ReplyDraft>(stmts.getDraft.get(id))
    },
    saveDraft(draft) {
      stmts.upsertDraft.run(draft.id, draft.state, draft.createdAt, JSON.stringify(draft))
    },
    deleteDraft(id) {
      stmts.deleteDraft.run(id)
    },

    close() {
      db.close()
    },
  }
  return store
}
