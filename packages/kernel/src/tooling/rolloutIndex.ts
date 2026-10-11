/**
 * node:sqlite index over the rollout files: thread metadata for listing and an FTS5 trigram table
 * over user / assistant text for zero-LLM search. The JSONL files stay the source of truth.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { z } from 'zod'
import type { ChannelKind, ItemId, ThreadId, ThreadOrigin, ThreadSettings, ToolProfile } from '@aiwc/protocol'
import type { RolloutSearchHit, RolloutSearchOptions, ThreadRecord } from '../ports'
import { shapeIssues, ThreadOriginSchema, ThreadSettingsSchema } from './rolloutLine'

/** Trigram tokenizer needs ≥ 3 characters; shorter queries fall back to LIKE. */
const TRIGRAM_MIN = 3

/** Shown in listings for a row whose column no longer parses; resume and rewrite read the rollout file instead. */
const LISTING_FALLBACK_ORIGIN: ThreadOrigin = { channel: 'desktop' }
const LISTING_FALLBACK_SETTINGS: ThreadSettings = { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] }

export type RolloutLogger = (level: 'warn', message: string, meta?: unknown) => void

/** A stored row. `origin` / `settings` are undefined when their JSON column no longer fits its schema. */
export type IndexedThread = Omit<ThreadRecord, 'origin' | 'settings'> & {
  origin?: ThreadOrigin
  settings?: ThreadSettings
}

type JsonColumn = 'origin_json' | 'settings_json'

/** json_extract that yields NULL for a malformed column instead of failing the whole query. */
const jsonField = (column: JsonColumn, path: '$.channel' | '$.profile'): string =>
  `CASE WHEN json_valid(${column}) THEN json_extract(${column}, '${path}') END`

export interface RolloutIndex {
  insertThread(rec: ThreadRecord): void
  /** The stored row, with unreadable columns left undefined so the caller falls back to the rollout file. */
  getThread(threadId: ThreadId): IndexedThread | undefined
  touch(
    threadId: ThreadId,
    patch: { updatedAt: number; itemCountDelta?: number; settings?: ThreadSettings; title?: string },
  ): void
  updateMeta(
    threadId: ThreadId,
    patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived' | 'settings'>>,
    updatedAt: number,
  ): void
  remove(threadId: ThreadId): void
  indexText(threadId: ThreadId, itemId: ItemId, ts: number, text: string): void
  /** Replace a thread's row and all of its FTS rows in one transaction (used by rewrite). */
  reindexThread(rec: ThreadRecord, texts: Array<{ itemId: ItemId; ts: number; text: string }>): void
  list(opts?: {
    query?: string
    limit?: number
    /** Rows to skip (paging); applied after the filters and the pinned / newest-first order. */
    offset?: number
    channel?: ChannelKind
    includeArchived?: boolean
    /** Only archived threads (wins over `includeArchived`). */
    archivedOnly?: boolean
    excludeProfiles?: readonly ToolProfile[]
    /** Leave out threads with no recorded item (created, then nothing was ever sent). */
    nonEmpty?: boolean
  }): ThreadRecord[]
  search(query: string, opts?: RolloutSearchOptions): RolloutSearchHit[]
  close(): void
}

const DEFAULT_MARKS: readonly [string, string] = ['[', ']']

export function openRolloutIndex(dbPath: string, logger?: RolloutLogger): RolloutIndex {
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

  /** Columns already reported, so a damaged row warns once per open index rather than on every listing. */
  const reported = new Set<string>()
  const warnColumn = (threadId: string, column: JsonColumn, detail: object): void => {
    const key = `${threadId}:${column}`
    if (reported.has(key)) return
    reported.add(key)
    logger?.('warn', 'rollout index: unreadable thread column, falling back', { threadId, column, ...detail })
  }
  const readColumn = <T>(threadId: string, column: JsonColumn, raw: unknown, schema: z.ZodType<T>): T | undefined => {
    let value: unknown
    try {
      value = JSON.parse(String(raw))
    } catch {
      warnColumn(threadId, column, { reason: 'invalid_json' })
      return undefined
    }
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
    warnColumn(threadId, column, { reason: 'invalid_shape', issues: shapeIssues(parsed.error) })
    return undefined
  }

  // The legacy 'plan' permission mode is normalised by ThreadSettingsSchema itself.
  const readRow = (row: Record<string, unknown>): IndexedThread => {
    const threadId = String(row.thread_id)
    return {
      threadId: threadId as ThreadId,
      origin: readColumn(threadId, 'origin_json', row.origin_json, ThreadOriginSchema),
      settings: readColumn(threadId, 'settings_json', row.settings_json, ThreadSettingsSchema),
      title: String(row.title ?? ''),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      pinned: Number(row.pinned) === 1,
      archived: Number(row.archived) === 1,
      itemCount: Number(row.item_count),
    }
  }

  const rowToRecord = (row: Record<string, unknown>): ThreadRecord => {
    const stored = readRow(row)
    return {
      ...stored,
      origin: stored.origin ?? LISTING_FALLBACK_ORIGIN,
      settings: stored.settings ?? LISTING_FALLBACK_SETTINGS,
    }
  }

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
      return row ? readRow(row) : undefined
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
      if (opts?.archivedOnly) where.push('archived = 1')
      else if (!opts?.includeArchived) where.push('archived = 0')
      if (opts?.channel) {
        where.push(`${jsonField('origin_json', '$.channel')} = ?`)
        params.push(opts.channel)
      }
      if (opts?.excludeProfiles?.length) {
        const placeholders = opts.excludeProfiles.map(() => '?').join(', ')
        where.push(`COALESCE(${jsonField('settings_json', '$.profile')}, '') NOT IN (${placeholders})`)
        params.push(...opts.excludeProfiles)
      }
      if (opts?.nonEmpty) where.push('item_count > 0')
      const q = opts?.query?.trim()
      if (q) {
        const sub = ftsPredicate(q)
        where.push(`(title LIKE ? ESCAPE '\\' OR thread_id IN (SELECT thread_id FROM items_fts WHERE ${sub.sql}))`)
        params.push(`%${escapeLike(q)}%`, sub.param)
      }
      const sql = `SELECT * FROM threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`
      params.push(Math.max(1, Math.min(opts?.limit ?? 100, 1000)), Math.max(0, Math.floor(opts?.offset ?? 0)))
      return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToRecord)
    },
    search(query, opts) {
      const q = query.trim()
      if (!q) return []
      const [open, close] = opts?.marks ?? DEFAULT_MARKS
      const sub = ftsPredicate(q)
      const where = [sub.sql]
      const params: Array<string | number> = [sub.param]
      if (opts?.threadId) {
        where.push('items_fts.thread_id = ?')
        params.push(opts.threadId)
      }
      if (!opts?.includeArchived) where.push('threads.archived = 0')
      if (opts?.channel) {
        where.push(`${jsonField('origin_json', '$.channel')} = ?`)
        params.push(opts.channel)
      }
      if (opts?.excludeProfiles?.length) {
        where.push(
          `COALESCE(${jsonField('settings_json', '$.profile')}, '') NOT IN (${opts.excludeProfiles.map(() => '?').join(', ')})`,
        )
        params.push(...opts.excludeProfiles)
      }
      params.push(Math.max(1, Math.min(opts?.limit ?? 20, 500)))
      const snippetExpr = sub.fts ? "snippet(items_fts, 3, ?, ?, '…', 16)" : 'items_fts.text'
      const rows = db
        .prepare(
          `SELECT items_fts.thread_id AS thread_id, items_fts.item_id AS item_id, items_fts.ts AS ts,
                  ${snippetExpr} AS snippet, threads.title AS title
           FROM items_fts JOIN threads ON threads.thread_id = items_fts.thread_id
           WHERE ${where.join(' AND ')} ORDER BY items_fts.ts DESC LIMIT ?`,
        )
        .all(...(sub.fts ? [open, close] : []), ...params) as Record<string, unknown>[]
      return rows.map((r) => ({
        threadId: String(r.thread_id) as ThreadId,
        itemId: String(r.item_id) as ItemId,
        ts: Number(r.ts),
        snippet: sub.fts ? String(r.snippet) : likeSnippet(String(r.snippet), q, open, close),
        title: String(r.title ?? ''),
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
  return { sql: "items_fts.text LIKE ? ESCAPE '\\'", param: `%${escapeLike(q)}%`, fts: false }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function likeSnippet(text: string, q: string, open = '[', close = ']', radius = 24): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, idx)}${open}${text.slice(idx, idx + q.length)}${close}${text.slice(idx + q.length, end)}${end < text.length ? '…' : ''}`
}
