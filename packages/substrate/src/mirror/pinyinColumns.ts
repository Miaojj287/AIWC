/**
 * The mirror's pinyin columns: `sessions.title_py` and `contacts.name_py` (see ./pinyin). NULL means
 * "not computed yet"; '' means "computed, nothing to add". Added to existing databases on open and
 * filled for every row still NULL, so a mirror written before pinyin search finds `zs` → 张三 at once;
 * the upserts keep them current on every sync.
 */
import type { Db } from './db'
import { pinyinSearchKey } from './pinyin'

/** Rows filled per transaction while backfilling, so a huge contact book never holds one long write lock. */
const BACKFILL_BATCH = 500

function addColumn(db: Db, table: 'sessions' | 'contacts', column: string): void {
  const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
}

/** Fill the key of every session / contact row whose key is still NULL. Returns how many rows were filled. */
export function fillMissingPinyin(db: Db): number {
  let filled = 0
  for (;;) {
    const rows = db.all<{ id: string; title: string | null }>(
      'SELECT id, title FROM sessions WHERE title_py IS NULL LIMIT ?',
      BACKFILL_BATCH,
    )
    if (!rows.length) break
    db.tx(() => {
      for (const r of rows) db.run('UPDATE sessions SET title_py = ? WHERE id = ?', pinyinSearchKey(r.title), r.id)
    })
    filled += rows.length
  }
  for (;;) {
    const rows = db.all<{ username: string; nickname: string | null; remark: string | null }>(
      'SELECT username, nickname, remark FROM contacts WHERE name_py IS NULL LIMIT ?',
      BACKFILL_BATCH,
    )
    if (!rows.length) break
    db.tx(() => {
      for (const r of rows)
        db.run('UPDATE contacts SET name_py = ? WHERE username = ?', pinyinSearchKey(r.remark, r.nickname), r.username)
    })
    filled += rows.length
  }
  return filled
}

/** Add the columns when missing. Idempotent; must run before any upsert writes them. */
export function addPinyinColumns(db: Db): void {
  addColumn(db, 'sessions', 'title_py')
  addColumn(db, 'contacts', 'name_py')
}
