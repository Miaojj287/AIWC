/**
 * listAccounts / verifyAccount / detectWeChat (main-process side, no UI, no native code).
 */
import type { WxAccount } from '@aiwc/protocol'
import { verifyDbKey } from '../key/sqlcipherPage'
import { findSessionDbCandidates, isAccountDir, resolveDbStoragePath } from '../wcdb/dbFiles'
import { detectDbRoot, listAccountDirs } from './dbRoots'
import { listWeChatProcesses, readWeChatVersion } from './processDetect'
import { basename, dirname } from 'node:path'

export interface DetectWeChatResult {
  running: boolean
  dbRoot?: string
  version?: string
  pid?: number
}

export async function detectWeChat(): Promise<DetectWeChatResult> {
  const [processes, version] = await Promise.all([listWeChatProcesses().catch(() => []), readWeChatVersion().catch(() => undefined)])
  const main = processes[0]
  const root = detectDbRoot()
  return {
    running: !!main,
    dbRoot: root?.path,
    version,
    pid: main?.pid,
  }
}

/**
 * Accounts under `dbRoot`. `wxid` is the account directory name (e.g. `wxid_abc123_a1b2`) so that it
 * unambiguously maps back to a directory; use cleanAccountDirName() for the bare wxid when needed.
 * Nicknames require the encrypted contact.db, so they are filled in later by the source reader.
 */
export async function listAccounts(dbRoot: string): Promise<WxAccount[]> {
  const normalized = String(dbRoot || '').replace(/[\\/]+$/, '')
  if (!normalized) return []
  if (basename(normalized).toLowerCase() === 'db_storage' && isAccountDir(dirname(normalized))) {
    const accountDir = dirname(normalized)
    return [{ wxid: basename(accountDir), dbRoot: dirname(accountDir), verified: false }]
  }
  if (isAccountDir(normalized)) {
    return [{ wxid: basename(normalized), dbRoot: dirname(normalized), verified: false }]
  }
  return listAccountDirs(normalized).map((name) => ({ wxid: name, dbRoot: normalized, verified: false }))
}

export interface VerifyAccountOptions {
  dbRoot: string
  wxid: string
  dbKeyHex?: string
}

/**
 * Without a key: check the directory shape (db_storage + session.db present).
 * With a key: additionally validate it against session.db's first page (pure TS, no native library).
 */
export async function verifyAccount(opts: VerifyAccountOptions): Promise<{ ok: boolean; error?: string }> {
  const storage = resolveDbStoragePath(opts.dbRoot, opts.wxid)
  if (!storage) return { ok: false, error: `未找到账号目录或 db_storage：${opts.dbRoot}` }
  const sessionDbs = findSessionDbCandidates(storage)
  if (sessionDbs.length === 0) return { ok: false, error: `未找到 session.db：${storage}` }
  if (!opts.dbKeyHex) return { ok: true }
  let lastError = '密钥与数据库不匹配'
  for (const candidate of sessionDbs) {
    const result = verifyDbKey(candidate, opts.dbKeyHex)
    if (result.ok) return { ok: true }
    if (result.error) lastError = result.error
  }
  return { ok: false, error: lastError }
}
