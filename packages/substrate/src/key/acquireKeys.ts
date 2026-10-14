/**
 * acquireKeys — obtain the db key and image keys for an account, reporting progress through onStep.
 * Steps mirror the KeyAcquireStep contract: db_key → image_xor → image_aes → verify. Each running step
 * carries a `phase` code (what is happening now) and each failed step a `failure` code (why it
 * stopped), so the UI can name the stage in its own language. Every native call has a timeout, the
 * whole run honours `signal`, and the result always closes every step (`done` or `failed`) — a
 * cancelled or crashed run never leaves a step spinning.
 */
import type { KeyAcquireFailure, KeyAcquireScope, KeyAcquireStep, WechatDbCredentialBundle } from '@aiwc/protocol'
import { relative } from 'node:path'
import { realpathSync } from 'node:fs'
import {
  findMessageShards,
  findNamedDb,
  findSessionDbCandidates,
  resolveAccountDir,
  resolveDbStoragePath,
} from '../wcdb/dbFiles'
import { cleanAccountDirName } from '../wcdb/accountUtils'
import { findWeChatPidSync } from '../discovery/processDetect'
import { verifyDbKey } from './sqlcipherPage'
import { validateKeyHexDetailed } from './validateKeyHex'
import { resolveImageKeys } from './imageKeys'
import { scanMacImageAesKey } from './macosMemoryScanner'
import { scanWindowsDbKey, scanWindowsImageAesKey } from './windowsMemoryScanner'
import { scanMacCodecCredentials } from './macosCodecScanner'
import { credentialDatabaseFiles } from './credentialFiles'
import { StepTracker } from './stepTracker'

/** Budget of one read-only memory / dump scan. */
const DB_SCAN_TIMEOUT_MS = 30_000
const IMAGE_SCAN_TIMEOUT_MS = 30_000

export interface AcquireKeysOptions {
  dbRoot: string
  wxid: string
  /** Both strategies read only; retained names keep old UI requests compatible. */
  strategy: 'auto' | 'memory_scan'
  /** 'image' = only the image keys: no db-key scan, no hook, no restart, no verify step. */
  scope?: KeyAcquireScope
  nativeDir: string
  onStep: (step: KeyAcquireStep) => void
  /** Budget of each read-only db-key scan (ms). */
  dbKeyTimeoutMs?: number
  imageKeyTimeoutMs?: number
  /** Cancels the run: running helpers are killed and every open step ends `failed` / 'cancelled'. */
  signal?: AbortSignal
  /** Commit verified database material before optional image work begins. */
  onDatabaseReady?: (result: {
    dbKeyHex: string
    dbCredentials?: WechatDbCredentialBundle
    currentPaths?: string[]
  }) => Promise<void>
}

export interface AcquireKeysResult {
  dbKeyHex?: string
  dbCredentials?: WechatDbCredentialBundle
  imageXorHex?: string
  imageAesHex?: string
  steps: KeyAcquireStep[]
  /** The run was aborted through `signal`. */
  cancelled?: boolean
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || (error as { code?: string }).code === 'ABORT_ERR')

/**
 * The databases this one key has to open. The reader needs all of them, and every SQLCipher file has
 * its own salt, so verifying only `session.db` would accept a key that cannot read a single message
 * (see verifyDbKeyAcross). Missing files are simply left out.
 */
function accountDbTargets(dbStoragePath: string): string[] {
  return [
    ...findSessionDbCandidates(dbStoragePath).slice(0, 1),
    findNamedDb(dbStoragePath, 'contact.db'),
    findMessageShards(dbStoragePath)[0]?.dbPath,
  ].filter((path): path is string => !!path)
}

async function acquireDbKey(
  opts: AcquireKeysOptions,
  dbStoragePath: string,
  tracker: StepTracker,
): Promise<string | undefined> {
  const timeout = opts.dbKeyTimeoutMs ?? DB_SCAN_TIMEOUT_MS

  if (process.platform === 'darwin') return undefined

  if (process.platform === 'win32') {
    const pid = findWeChatPidSync()
    if (!pid) {
      tracker.fail('db_key', '未检测到微信进程，请先登录微信', 'wechat_not_running')
      return undefined
    }
    const sessionDb = findSessionDbCandidates(dbStoragePath)[0]
    if (!sessionDb) {
      tracker.fail('db_key', '未找到 session.db')
      return undefined
    }
    tracker.phase('db_key', 'reading_memory')
    // Synchronous native scan bounded by its own deadline (it cannot observe `signal` mid-scan).
    const scan = scanWindowsDbKey(pid, sessionDb, Date.now() + timeout, accountDbTargets(dbStoragePath))
    if (scan.key) {
      return scan.key
    }
    if (scan.opened) tracker.fail('db_key', '内存中未找到匹配的数据库密钥，请在登录后重试', 'not_found')
    else tracker.fail('db_key', '无法读取微信进程内存（可能需要管理员权限）', 'needs_authorization')
    return undefined
  }

  tracker.fail('db_key', undefined, 'unsupported_version')
  return undefined
}

async function acquireImageKeys(
  opts: AcquireKeysOptions,
  accountDir: string,
  tracker: StepTracker,
): Promise<{ xorHex?: string; aesHex?: string }> {
  tracker.phase('image_xor', 'deriving_image_key')
  const wxidCandidates = Array.from(
    new Set([basenameOf(accountDir), opts.wxid, cleanAccountDirName(opts.wxid)].filter(Boolean)),
  )
  const timeout = opts.imageKeyTimeoutMs ?? IMAGE_SCAN_TIMEOUT_MS
  let imageFailure: KeyAcquireFailure = 'not_found'
  const memoryScan = async (ciphertext: Buffer): Promise<string | null> => {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    tracker.phase('image_aes', 'scanning_image_key')
    const pid = findWeChatPidSync()
    if (!pid) {
      imageFailure = 'wechat_not_running'
      return null
    }
    if (process.platform === 'darwin') {
      const scan = await scanMacImageAesKey(pid, ciphertext, opts.nativeDir, timeout, opts.signal)
      imageFailure = scan.failure ?? 'not_found'
      return scan.key ?? null
    }
    if (process.platform === 'win32') return scanWindowsImageAesKey(pid, ciphertext, Date.now() + timeout)
    imageFailure = 'unsupported_version'
    return null
  }

  const result = await resolveImageKeys(accountDir, wxidCandidates, memoryScan)
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  if (result.xorHex) tracker.done('image_xor', '图片 XOR 密钥获取成功')
  else tracker.fail('image_xor', result.error ?? '未能获取 XOR 密钥', 'not_found')

  if (result.aesHex) tracker.done('image_aes', '图片 AES 密钥获取成功')
  else tracker.fail('image_aes', imageFailure === 'not_found' ? result.error : undefined, imageFailure)
  return { xorHex: result.xorHex, aesHex: result.aesHex }
}

function basenameOf(dir: string): string {
  return (
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  )
}

/**
 * Run the key acquisition. Never throws: an abort ends every open step as 'cancelled', an unexpected
 * error fails the running step with a stable code and closes the rest as 'skipped'.
 */
export async function acquireKeys(opts: AcquireKeysOptions): Promise<AcquireKeysResult> {
  const tracker = new StepTracker(opts.onStep, opts.scope)
  const found: Omit<AcquireKeysResult, 'steps'> = {}
  try {
    const result = await runAcquisition(opts, tracker, found)
    return { ...result, steps: tracker.finish('skipped') }
  } catch (error) {
    if (isAbort(error) || opts.signal?.aborted) return { ...found, steps: tracker.finish('cancelled'), cancelled: true }
    const running = tracker.steps.find((s) => s.status === 'doing')
    tracker.fail(running?.id ?? 'db_key', undefined, 'unexpected')
    // Keys found before the crash are still good, except an unverified db key.
    return { ...found, steps: tracker.finish('skipped') }
  }
}

async function runAcquisition(
  opts: AcquireKeysOptions,
  tracker: StepTracker,
  found: Omit<AcquireKeysResult, 'steps'>,
): Promise<Omit<AcquireKeysResult, 'steps'>> {
  const dbStoragePath = resolveDbStoragePath(opts.dbRoot, opts.wxid)
  const accountDir = resolveAccountDir(opts.dbRoot, opts.wxid)
  if (!dbStoragePath || !accountDir) {
    tracker.fail(opts.scope === 'image' ? 'image_xor' : 'db_key', undefined, 'not_found')
    return {}
  }
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  if (opts.scope !== 'image') {
    const database = await acquireVerifiedDatabase(opts, dbStoragePath, tracker)
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (!database) return found
    await opts.onDatabaseReady?.(database)
    found.dbKeyHex = database.dbKeyHex
    found.dbCredentials = database.dbCredentials
    tracker.done('db_key')
    tracker.done('verify')
    if (opts.scope === 'database') return found
  }
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const image = await acquireImageKeys(opts, accountDir, tracker)
  found.imageXorHex = image.xorHex
  found.imageAesHex = image.aesHex
  return found
}

async function acquireVerifiedDatabase(
  opts: AcquireKeysOptions,
  storage: string,
  tracker: StepTracker,
): Promise<{ dbKeyHex: string; dbCredentials?: WechatDbCredentialBundle; currentPaths?: string[] } | undefined> {
  tracker.phase('db_key', 'reading_memory')
  if (process.platform === 'darwin') {
    const canonicalStorage = realpathSync(storage)
    const pid = findWeChatPidSync()
    if (!pid) {
      tracker.fail('db_key', undefined, 'wechat_not_running')
      return undefined
    }
    const targets = credentialDatabaseFiles(canonicalStorage)
    if (!targets.length) {
      tracker.fail('db_key', undefined, 'not_found')
      return undefined
    }
    const result = await scanMacCodecCredentials({
      pid,
      nativeDir: opts.nativeDir,
      dbStoragePath: canonicalStorage,
      accountId: opts.wxid,
      targets,
      timeoutMs: opts.dbKeyTimeoutMs,
      signal: opts.signal,
    })
    const sessionPaths = findSessionDbCandidates(canonicalStorage)
    const session = result.bundle?.entries.find((entry) =>
      sessionPaths.some((path) => path.replace(/\\/g, '/').endsWith('/' + entry.relativePath)),
    )
    if (!session) {
      tracker.fail('db_key', undefined, result.failure ?? 'not_found')
      return undefined
    }
    tracker.phase('verify', 'verifying')
    return {
      dbKeyHex: session.keyHex,
      dbCredentials: result.bundle,
      currentPaths: targets.map((path) => relative(canonicalStorage, path).split('\\').join('/')),
    }
  }
  const dbKeyHex = await acquireDbKey(opts, storage, tracker)
  if (!dbKeyHex) {
    tracker.fail('verify', undefined, 'skipped')
    return undefined
  }
  tracker.phase('verify', 'verifying')
  const check = validateKeyHexDetailed(dbKeyHex)
  const target = findSessionDbCandidates(storage)[0]
  if (!check.ok || !target || !verifyDbKey(target, dbKeyHex).ok) {
    tracker.fail('verify', undefined, 'not_found')
    return undefined
  }
  return { dbKeyHex: check.normalized ?? dbKeyHex }
}
