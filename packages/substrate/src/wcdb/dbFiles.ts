/**
 * On-disk layout of a WeChat 4.x account:
 *   <dbRoot>/<wxid_or_dir>/db_storage/{session/session.db, contact/contact.db, message/message_N.db,
 *   biz_message/biz_message_N.db, media/media_N.db, hardlink/hardlink.db, head_image/head_image.db}
 *   <dbRoot>/<wxid_or_dir>/msg/{attach,video,file}/...
 * Everything here is synchronous fs metadata work (cheap) and unit-tested against temp trees.
 */
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const MAX_DEPTH = 5

function safeReadDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Whether `entryPath` looks like an account directory (holds databases or media). */
export function isAccountDir(entryPath: string): boolean {
  return (
    existsSync(join(entryPath, 'db_storage')) ||
    existsSync(join(entryPath, 'msg', 'attach')) ||
    existsSync(join(entryPath, 'FileStorage', 'Image')) ||
    existsSync(join(entryPath, 'FileStorage', 'Image2'))
  )
}

/**
 * Resolve `db_storage` for an account. `dbRoot` may be the storage dir itself, the account dir,
 * or the parent that contains `<wxid>/` or `<wxid>_xxxx/`.
 */
export function resolveDbStoragePath(dbRoot: string, wxid: string): string | null {
  if (!dbRoot) return null
  const normalized = dbRoot.replace(/[\\/]+$/, '')
  const matches = (name: string) => !wxid || name.toLowerCase() === wxid.toLowerCase() || name.toLowerCase().startsWith(`${wxid.toLowerCase()}_`)
  if (basename(normalized).toLowerCase() === 'db_storage' && existsSync(normalized)) {
    return matches(basename(dirname(normalized))) ? normalized : null
  }
  const direct = join(normalized, 'db_storage')
  if (existsSync(direct)) return matches(basename(normalized)) ? direct : null
  if (wxid) {
    const viaWxid = join(normalized, wxid, 'db_storage')
    if (existsSync(viaWxid)) return viaWxid
    const lowerWxid = wxid.toLowerCase()
    for (const entry of safeReadDir(normalized)) {
      if (!entry.isDirectory()) continue
      const lowerEntry = entry.name.toLowerCase()
      if (lowerEntry !== lowerWxid && !lowerEntry.startsWith(`${lowerWxid}_`)) continue
      const candidate = join(normalized, entry.name, 'db_storage')
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** The account directory (parent of db_storage). */
export function resolveAccountDir(dbRoot: string, wxid: string): string | null {
  const storage = resolveDbStoragePath(dbRoot, wxid)
  return storage ? dirname(storage) : null
}

function collectFiles(root: string, matcher: (lowerName: string) => boolean, depth = 0, acc: string[] = []): string[] {
  if (depth > MAX_DEPTH) return acc
  for (const entry of safeReadDir(root)) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(full, matcher, depth + 1, acc)
    else if (entry.isFile() && matcher(entry.name.toLowerCase()) && !acc.includes(full)) acc.push(full)
  }
  return acc
}

function scoreSessionDb(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  let score = 0
  if (normalized.endsWith('/session/session.db')) score += 40
  if (normalized.includes('/db_storage/session/')) score += 20
  if (normalized.includes('/db_storage/')) score += 10
  return score
}

/** All `session.db` candidates under db_storage, best first. */
export function findSessionDbCandidates(dbStoragePath: string): string[] {
  const direct = join(dbStoragePath, 'session', 'session.db')
  const list = existsSync(direct) ? [direct] : []
  for (const found of collectFiles(dbStoragePath, (name) => name === 'session.db')) {
    if (!list.includes(found)) list.push(found)
  }
  return list.sort((a, b) => scoreSessionDb(b) - scoreSessionDb(a) || a.localeCompare(b))
}

/** Locate `<name>.db` (e.g. contact.db, hardlink.db, head_image.db); prefers `<name>/<name>.db`. */
export function findNamedDb(dbStoragePath: string, dbName: string): string | null {
  const lower = dbName.toLowerCase().endsWith('.db') ? dbName.toLowerCase() : `${dbName.toLowerCase()}.db`
  const stem = lower.slice(0, -3)
  const direct = join(dbStoragePath, stem, lower)
  if (existsSync(direct)) return direct
  const list = collectFiles(dbStoragePath, (name) => name === lower)
  if (list.length === 0) return null
  list.sort((a, b) => a.length - b.length)
  return list[0] ?? null
}

export type MessageShardKind = 'message' | 'biz_message'

export interface MessageShard {
  dbPath: string
  kind: MessageShardKind
}

const MESSAGE_SHARD_RE = /^(?:msg|message)_\d+\.db$/i
const BIZ_SHARD_RE = /^biz_message_\d+\.db$/i

function shardKind(lowerName: string): MessageShardKind | null {
  if (BIZ_SHARD_RE.test(lowerName)) return 'biz_message'
  if (MESSAGE_SHARD_RE.test(lowerName)) return 'message'
  return null
}

/** Message shards (`message_N.db`, `biz_message_N.db`), sorted by numeric suffix. */
export function findMessageShards(dbStoragePath: string): MessageShard[] {
  const shards: MessageShard[] = []
  const seen = new Set<string>()
  const push = (path: string) => {
    if (seen.has(path)) return
    const kind = shardKind(basename(path).toLowerCase())
    if (!kind) return
    seen.add(path)
    shards.push({ dbPath: path, kind })
  }
  for (const sub of ['message', 'biz_message']) {
    const dir = join(dbStoragePath, sub)
    for (const entry of safeReadDir(dir)) {
      if (entry.isFile()) push(join(dir, entry.name))
    }
  }
  if (shards.length === 0) {
    for (const found of collectFiles(dbStoragePath, (name) => shardKind(name) !== null)) push(found)
  }
  const num = (p: string) => Number.parseInt(/_(\d+)\.db$/i.exec(basename(p))?.[1] ?? '0', 10)
  return shards.sort((a, b) => a.kind.localeCompare(b.kind) || num(a.dbPath) - num(b.dbPath) || a.dbPath.localeCompare(b.dbPath))
}

/** `media_N.db` shards holding voice blobs. */
export function findMediaDbs(dbStoragePath: string): string[] {
  const dir = join(dbStoragePath, 'media')
  const direct = safeReadDir(dir)
    .filter((e) => e.isFile() && /^media_?\d*\.db$/i.test(e.name))
    .map((e) => join(dir, e.name))
  if (direct.length > 0) return direct.sort()
  return collectFiles(dbStoragePath, (name) => /^media_?\d*\.db$/i.test(name)).sort()
}

/** Latest mtime among the account's data directories (used to guess the active account). */
export function accountModifiedTime(accountDir: string): number {
  try {
    let latest = statSync(accountDir).mtimeMs
    for (const candidate of [
      join(accountDir, 'db_storage'),
      join(accountDir, 'db_storage', 'session', 'session.db'),
      join(accountDir, 'msg', 'attach'),
      join(accountDir, 'FileStorage', 'Image'),
    ]) {
      if (existsSync(candidate)) latest = Math.max(latest, statSync(candidate).mtimeMs)
    }
    return latest
  } catch {
    return 0
  }
}

/** Directories under db_storage worth watching for change notifications. */
export function watchableDirs(dbStoragePath: string): string[] {
  return ['session', 'message', 'biz_message', 'contact', 'head_image']
    .map((sub) => join(dbStoragePath, sub))
    .filter((dir) => existsSync(dir))
}
