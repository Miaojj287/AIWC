/**
 * node:sqlite index over the rollout files: thread metadata for listing and an FTS5 trigram table
 * over user / assistant text for zero-LLM search. The JSONL files stay the source of truth.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizePermissionMode, type ChannelKind, type ItemId, type ThreadId, type ThreadOrigin, type ThreadSettings } from '@aiwc/protocol'
import type { ThreadRecord } from '../ports'

/** Trigram tokenizer needs ≥ 3 characters; shorter queries fall back to LIKE. */
const TRIGRAM_MIN = 3

export interface RolloutIndex {
  insertThread(rec: ThreadRecord): void
  getThread(threadId: ThreadId): ThreadRecord | undefined
  touch(threadId: ThreadId, patch: { updatedAt: number; itemCountDelta?: number; settings?: ThreadSettings; title?: string }): void
  updateMeta(threadId: ThreadId, patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived' | 'settings'>>, updatedAt: number): void
  remove(threadId: ThreadId): void
  indexText(threadId: ThreadId, itemId: ItemId, ts: number, text: string): void
  /** Replace a thread's row and all of its FTS rows in one transaction (used by rewrite). */
  reindexThread(rec: ThreadRecord, texts: Array<{ itemId: ItemId; ts: number; text: string }>): void
  list(opts?: { query?: string; limit?: number; channel?: ChannelKind; includeArchived?: boolean }): ThreadRecord[]
  search(query: string, opts?: { limit?: number; threadId?: ThreadId }): Array<{ threadId: ThreadId; itemId: ItemId; snippet: string; ts: number }>
  close(): void
}

export function openRolloutIndex(dbPath: string): RolloutIndex {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      origin_json TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS threads_order ON threads (pinned DESC, updated_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      thread_id UNINDEXED, item_id UNINDEXED, ts UNINDEXED, text, tokenize = 'trigram'
    );
  `)

  const stmts = {
    insert: db.prepare(
      `INSERT OR REPLACE INTO threads (thread_id, origin_json, settings_json, title, created_at, updated_at, pinned, archived, item_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    get: db.prepare('SELECT * FROM threads WHERE thread_id = ?'),
    touch: db.prepare('UPDATE threads SET updated_at = ?, item_count = item_count + ? WHERE thread_id = ?'),
    setSettings: db.prepare('UPDATE threads SET settings_json = ? WHERE thread_id = ?'),
    setTitle: db.prepare('UPDATE threads SET title = ? WHERE thread_id = ?'),
    setPinned: db.prepare('UPDATE threads SET pinned = ? WHERE thread_id = ?'),
    setArchived: db.prepare('UPDATE threads SET archived = ? WHERE thread_id = ?'),
    setUpdated: db.prepare('UPDATE threads SET updated_at = ? WHERE thread_id = ?'),
    removeThread: db.prepare('DELETE FROM threads WHERE thread_id = ?'),
    removeFts: db.prepare('DELETE FROM items_fts WHERE thread_id = ?'),
    insertFts: db.prepare('INSERT INTO items_fts (thread_id, item_id, ts, text) VALUES (?, ?, ?, ?)'),
  }

  /** A row written by an older build may name a permission mode that no longer exists. */
  const normalizeSettings = (settings: ThreadSettings): ThreadSettings =>
    settings.permissionMode === normalizePermissionMode(settings.permissionMode)
      ? settings
      : { ...settings, permissionMode: normalizePermissionMode(settings.permissionMode) }

  const rowToRecord = (row: Record<string, unknown>): ThreadRecord => ({
    threadId: String(row.thread_id) as ThreadId,
    origin: parseJson<ThreadOrigin>(row.origin_json, { channel: 'desktop' }),
    settings: normalizeSettings(parseJson<ThreadSettings>(row.settings_json, { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] })),
    title: String(row.title ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    pinned: Number(row.pinned) === 1,
    archived: Number(row.archived) === 1,
    itemCount: Number(row.item_count),
  })

  return {
    insertThread(rec) {
      stmts.insert.run(
        rec.threadId,
        JSON.stringify(rec.origin),
        JSON.stringify(rec.settings),
        rec.title,
        rec.createdAt,
        rec.updatedAt,
        rec.pinned ? 1 : 0,
        rec.archived ? 1 : 0,
        rec.itemCount,
      )
    },
    getThread(threadId) {
      const row = stmts.get.get(threadId) as Record<string, unknown> | undefined
      return row ? rowToRecord(row) : undefined
    },
    touch(threadId, patch) {
      stmts.touch.run(patch.updatedAt, patch.itemCountDelta ?? 0, threadId)
      if (patch.settings) stmts.setSettings.run(JSON.stringify(patch.settings), threadId)
      if (patch.title !== undefined) stmts.setTitle.run(patch.title, threadId)
    },
    updateMeta(threadId, patch, updatedAt) {
      db.exec('BEGIN')
      try {
        if (patch.title !== undefined) stmts.setTitle.run(patch.title, threadId)
        if (patch.pinned !== undefined) stmts.setPinned.run(patch.pinned ? 1 : 0, threadId)
        if (patch.archived !== undefined) stmts.setArchived.run(patch.archived ? 1 : 0, threadId)
        if (patch.settings !== undefined) stmts.setSettings.run(JSON.stringify(patch.settings), threadId)
        stmts.setUpdated.run(updatedAt, threadId)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    remove(threadId) {
      db.exec('BEGIN')
      try {
        stmts.removeFts.run(threadId)
        stmts.removeThread.run(threadId)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    indexText(threadId, itemId, ts, text) {
      if (!text.trim()) return
      stmts.insertFts.run(threadId, itemId, ts, text)
    },
    reindexThread(rec, texts) {
      db.exec('BEGIN')
      try {
        stmts.removeFts.run(rec.threadId)
        this.insertThread(rec)
        for (const t of texts) this.indexText(rec.threadId, t.itemId, t.ts, t.text)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    list(opts) {
      const where: string[] = []
      const params: Array<string | number> = []
      if (!opts?.includeArchived) where.push('archived = 0')
      if (opts?.channel) {
        where.push("json_extract(origin_json, '$.channel') = ?")
        params.push(opts.channel)
      }
      const q = opts?.query?.trim()
      if (q) {
        const sub = ftsPredicate(q)
        where.push(`(title LIKE ? ESCAPE '\\' OR thread_id IN (SELECT thread_id FROM items_fts WHERE ${sub.sql}))`)
        params.push(`%${escapeLike(q)}%`, sub.param)
      }
      const sql = `SELECT * FROM threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY pinned DESC, updated_at DESC LIMIT ?`
      params.push(Math.max(1, Math.min(opts?.limit ?? 100, 1000)))
      return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToRecord)
    },
    search(query, opts) {
      const q = query.trim()
      if (!q) return []
      const sub = ftsPredicate(q)
      const where = [sub.sql]
      const params: Array<string | number> = [sub.param]
      if (opts?.threadId) {
        where.push('thread_id = ?')
        params.push(opts.threadId)
      }
      params.push(Math.max(1, Math.min(opts?.limit ?? 20, 500)))
      const snippetExpr = sub.fts ? "snippet(items_fts, 3, '[', ']', '…', 16)" : 'text'
      const rows = db
        .prepare(`SELECT thread_id, item_id, ts, ${snippetExpr} AS snippet FROM items_fts WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`)
        .all(...params) as Record<string, unknown>[]
      return rows.map((r) => ({
        threadId: String(r.thread_id) as ThreadId,
        itemId: String(r.item_id) as ItemId,
        ts: Number(r.ts),
        snippet: sub.fts ? String(r.snippet) : likeSnippet(String(r.snippet), q),
      }))
    },
    close() {
      db.close()
    },
  }
}

/** MATCH for ≥3-char queries (quoted phrase, safe against FTS syntax), LIKE for shorter ones. */
function ftsPredicate(q: string): { sql: string; param: string; fts: boolean } {
  if ([...q].length >= TRIGRAM_MIN) {
    return { sql: 'items_fts MATCH ?', param: `"${q.replace(/"/g, '""')}"`, fts: true }
  }
  return { sql: "text LIKE ? ESCAPE '\\'", param: `%${escapeLike(q)}%`, fts: false }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function likeSnippet(text: string, q: string, radius = 24): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, idx)}[${text.slice(idx, idx + q.length)}]${text.slice(idx + q.length, end)}${end < text.length ? '…' : ''}`
}

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T
  } catch {
    return fallback
  }
}
