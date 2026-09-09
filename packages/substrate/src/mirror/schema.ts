import { Db } from './db'

export const MIRROR_SCHEMA_VERSION = 3

const DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  avatar_path TEXT,
  last_message_at INTEGER,
  last_preview TEXT,
  last_sender TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  indexed_until INTEGER,
  watermark_seq INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  pinned_local INTEGER,
  muted_local INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_order ON sessions(pinned DESC, last_message_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
  username TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  remark TEXT,
  alias TEXT,
  avatar_path TEXT,
  kind TEXT NOT NULL DEFAULT 'friend',
  last_contact_at INTEGER
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  PRIMARY KEY (group_id, username)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT,
  is_self INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  media_json TEXT,
  quote_json TEXT,
  UNIQUE (session_id, msg_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_tri USING fts5(text, content='messages', content_rowid='id', tokenize='trigram');

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  INSERT INTO messages_fts_tri(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts_tri(messages_fts_tri, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  INSERT INTO messages_fts_tri(messages_fts_tri, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts_tri(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  anchor_seq INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id, end_seq);

CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id INTEGER PRIMARY KEY,
  dims INTEGER NOT NULL,
  model TEXT,
  vec BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_transcripts (
  session_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, msg_id)
);

CREATE TABLE IF NOT EXISTS sql_audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  sql TEXT NOT NULL,
  reason TEXT,
  rows INTEGER
);
`

export function openMirrorDb(dbPath: string): Db {
  const db = new Db(dbPath)
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  db.exec('PRAGMA temp_store = MEMORY')
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(DDL)
  const current = db.get<{ v: string }>('SELECT v FROM meta WHERE k = ?', 'schema_version')?.v
  const cols = db.all<{ name: string }>('PRAGMA table_info(sessions)')
  if (!cols.some((c) => c.name === 'collapsed')) db.exec('ALTER TABLE sessions ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0')
  const messageCols = db.all<{ name: string }>('PRAGMA table_info(messages)')
  if (!messageCols.some((c) => c.name === 'presentation_json')) db.exec('ALTER TABLE messages ADD COLUMN presentation_json TEXT')
  if (current !== String(MIRROR_SCHEMA_VERSION)) db.run('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)', 'schema_version', String(MIRROR_SCHEMA_VERSION))
  // Previous readers used local_id as a global key, dropping rows when shards reused it
  // while still advancing watermarks. Replay incrementally to recover those missing rows.
  const identity = db.get<{ v: string }>('SELECT v FROM meta WHERE k = ?', 'source_identity')?.v
  if (identity?.startsWith('["wcdb",') && !db.get('SELECT v FROM meta WHERE k = ?', 'message_identity_v2')) {
    db.tx(() => {
      db.run('UPDATE sessions SET watermark_seq = 0, indexed_count = (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id), indexed_until = (SELECT MAX(created_at) FROM messages WHERE session_id = sessions.id)')
      db.run('INSERT INTO meta(k, v) VALUES (?, ?)', 'message_identity_v2', '1')
    })
  }
  return db
}
