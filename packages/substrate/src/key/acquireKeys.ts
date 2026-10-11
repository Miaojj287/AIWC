/**
 * acquireKeys — obtain the db key and image keys for an account, reporting progress through onStep.
 * Steps mirror the KeyAcquireStep contract: db_key → image_xor → image_aes → verify. Each running step
 * carries a `phase` code (what is happening now) and each failed step a `failure` code (why it
 * stopped), so the UI can name the stage in its own language. Every native call has a timeout, the
 * whole run honours `signal`, and the result always closes every step (`done` or `failed`) — a
 * cancelled or crashed run never leaves a step spinning.
 */
import type { KeyAcquireScope, KeyAcquireStep } from '@aiwc/protocol'
import {
  findMessageShards,
  findNamedDb,
  findSessionDbCandidates,
  resolveAccountDir,
  resolveDbStoragePath,
} from '../wcdb/dbFiles'
import { cleanAccountDirName } from '../wcdb/accountUtils'
import { findWeChatPidSync } from '../discovery/processDetect'
import { verifyDbKey, verifyDbKeyAcross } from './sqlcipherPage'
import { validateKeyHexDetailed } from './validateKeyHex'
import { resolveImageKeys } from './imageKeys'
import {
  captureMacDbKeyViaHook,
  isSipEnabled,
  scanMacDbKey,
  scanMacDbKeyFromDumps,
  scanMacImageAesKey,
} from './macosMemoryScanner'
import { scanWindowsDbKey, scanWindowsImageAesKey } from './windowsMemoryScanner'
import { runMacDbKeyFlow, type RelaunchCapture } from './macDbKeyFlow'
import { StepTracker } from './stepTracker'

export type { RelaunchCapture } from './macDbKeyFlow'

/** Budget of one read-only memory / dump scan. */
const DB_SCAN_TIMEOUT_MS = 30_000
/** How long the armed login hook waits for the user to log out and back in (they need time to read the prompt). */
const HOOK_WAIT_MS = 120_000
/** How long a relaunched WeChat gets to log in (QR scan / phone confirmation included). */
const RELAUNCH_WAIT_MS = 120_000

export interface AcquireKeysOptions {
  dbRoot: string
  wxid: string
  /** `memory_scan` = read-only paths only (live memory + crash dumps); never hooks or restarts WeChat. */
  strategy: 'auto' | 'memory_scan'
  /** 'image' = only the image keys: no db-key scan, no hook, no restart, no verify step. */
  scope?: KeyAcquireScope
  nativeDir: string
  onStep: (step: KeyAcquireStep) => void
  /** Budget of each read-only db-key scan (ms). */
  dbKeyTimeoutMs?: number
  /** How long the macOS login hook waits for the user (ms). */
  hookTimeoutMs?: number
  /** How long the relaunch capture waits for WeChat to log in again (ms). */
  relaunchTimeoutMs?: number
  imageKeyTimeoutMs?: number
  /** Cancels the run: running helpers are killed and every open step ends `failed` / 'cancelled'. */
  signal?: AbortSignal
  /**
   * Host-provided last-resort capture that restarts WeChat and scans the fresh login process for the
   * db key. Injected by electron main because only it may kill and relaunch WeChat; the pure package
   * never touches processes on its own.
   */
  relaunchCapture?: RelaunchCapture
}

export interface AcquireKeysResult {
  dbKeyHex?: string
  imageXorHex?: string
  imageAesHex?: string
  steps: KeyAcquireStep[]
  /** The run was aborted through `signal`. */
  cancelled?: boolean
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || (error as { code?: string }).code === 'ABORT_ERR')

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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

  if (process.platform === 'darwin') {
    // The helper reads the SQLCipher salt from a concrete session.db, so scan against that file, not
    // the db_storage directory.
    const sessionDb = findSessionDbCandidates(dbStoragePath)[0]
    if (!sessionDb) {
      tracker.fail('db_key', `未找到 session.db：${dbStoragePath}`)
      return undefined
    }
    const outcome = await runMacDbKeyFlow(
      {
        findPid: findWeChatPidSync,
        scanLive: (pid, db, ms, signal) => scanMacDbKey(pid, db, opts.nativeDir, ms, signal),
        scanDumps: (db, ms, signal) => scanMacDbKeyFromDumps(db, opts.nativeDir, ms, signal),
        isSipEnabled,
        captureHook: (pid, options) => captureMacDbKeyViaHook(pid, opts.nativeDir, options),
        relaunchCapture: opts.relaunchCapture,
      },
      {
        sessionDb,
        strategy: opts.strategy,
        scanTimeoutMs: timeout,
        hookTimeoutMs: opts.hookTimeoutMs ?? HOOK_WAIT_MS,
        relaunchTimeoutMs: opts.relaunchTimeoutMs ?? RELAUNCH_WAIT_MS,
        signal: opts.signal,
        onPhase: (phase, waitUntil) => tracker.phase('db_key', phase, waitUntil),
      },
    )
    if (outcome.key) {
      tracker.done('db_key', outcome.detail)
      return outcome.key
    }
    tracker.fail('db_key', outcome.detail, outcome.failure)
    return undefined
  }

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
      tracker.done('db_key', '已从微信进程内存获取密钥')
      return scan.key
    }
    if (scan.opened) tracker.fail('db_key', '内存中未找到匹配的数据库密钥，请在登录后重试', 'not_found')
    // No code: the coded needs_authorization copy is about macOS; this package text names the Windows fix.
    else tracker.fail('db_key', '无法读取微信进程内存（可能需要管理员权限）')
    return undefined
  }

  tracker.fail('db_key', `不支持的平台: ${process.platform}`)
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
  const timeout = opts.imageKeyTimeoutMs ?? 30_000
  const pid = findWeChatPidSync()
  const memoryScan = pid
    ? async (ciphertext: Buffer): Promise<string | null> => {
        if (opts.signal?.aborted) return null
        tracker.phase('image_aes', 'scanning_image_key')
        if (process.platform === 'darwin')
          return scanMacImageAesKey(pid, ciphertext, opts.nativeDir, timeout, opts.signal)
        if (process.platform === 'win32') return scanWindowsImageAesKey(pid, ciphertext, Date.now() + timeout)
        return null
      }
    : undefined

  const result = await resolveImageKeys(accountDir, wxidCandidates, memoryScan)
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  if (result.xorHex) tracker.done('image_xor', `XOR 密钥 0x${result.xorHex}`)
  else tracker.fail('image_xor', result.error ?? '未能获取 XOR 密钥')

  if (result.aesHex) tracker.done('image_aes', '图片 AES 密钥获取成功')
  else tracker.fail('image_aes', result.error ?? '未能获取图片 AES 密钥（可仅使用 XOR 密钥）')
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
 * error fails the running step with its message ('unexpected') and closes the rest as 'skipped'.
 */
export async function acquireKeys(opts: AcquireKeysOptions): Promise<AcquireKeysResult> {
  const tracker = new StepTracker(opts.onStep, opts.scope)
  const found: { dbKeyHex?: string; imageXorHex?: string; imageAesHex?: string } = {}
  try {
    const result = await runAcquisition(opts, tracker, found)
    return { ...result, steps: tracker.finish('skipped') }
  } catch (error) {
    if (isAbort(error) || opts.signal?.aborted) return { steps: tracker.finish('cancelled'), cancelled: true }
    const running = tracker.steps.find((s) => s.status === 'doing')
    tracker.fail(running?.id ?? 'db_key', errorText(error), 'unexpected')
    // Keys found before the crash are still good, except an unverified db key.
    return { imageXorHex: found.imageXorHex, imageAesHex: found.imageAesHex, steps: tracker.finish('skipped') }
  }
}

async function runAcquisition(
  opts: AcquireKeysOptions,
  tracker: StepTracker,
  found: { imageXorHex?: string; imageAesHex?: string },
): Promise<Omit<AcquireKeysResult, 'steps'>> {
  const dbStoragePath = resolveDbStoragePath(opts.dbRoot, opts.wxid)
  const accountDir = resolveAccountDir(opts.dbRoot, opts.wxid)
  if (!dbStoragePath || !accountDir) {
    tracker.fail(opts.scope === 'image' ? 'image_xor' : 'db_key', `未找到账号目录或 db_storage：${opts.dbRoot}`)
    return {}
  }
  if (opts.scope === 'image') {
    const image = await acquireImageKeys(opts, accountDir, tracker)
    return { imageXorHex: image.xorHex, imageAesHex: image.aesHex }
  }

  const dbKeyHex = await acquireDbKey(opts, dbStoragePath, tracker)
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const image = await acquireImageKeys(opts, accountDir, tracker)
  found.imageXorHex = image.xorHex
  found.imageAesHex = image.aesHex
  const imageKeys = { imageXorHex: image.xorHex, imageAesHex: image.aesHex }

  if (!dbKeyHex) {
    tracker.fail('verify', '未获取到数据库密钥', 'skipped')
    return imageKeys
  }
  tracker.phase('verify', 'verifying')
  const check = validateKeyHexDetailed(dbKeyHex)
  if (!check.ok) {
    tracker.fail('verify', check.error ?? '密钥格式非法')
    return imageKeys
  }
  // The session database is the gate. Whether this one key also covers the others depends on the
  // platform: WeChat on Windows keys every database separately and the rest are resolved at read
  // time (key/dbKeyResolver.ts), so covering only the session database is normal there.
  const targets = accountDbTargets(dbStoragePath)
  const across = verifyDbKeyAcross(targets, dbKeyHex)
  const sessionDb = targets[0]
  const sessionOnly = !across.ok && sessionDb ? verifyDbKey(sessionDb, dbKeyHex) : undefined
  if (across.ok) tracker.done('verify', '数据库密钥校验通过')
  else if (sessionOnly?.ok) tracker.done('verify', '会话数据库密钥校验通过；其余数据库在读取时各自取用密钥')
  else tracker.fail('verify', across.error ?? '密钥校验失败')
  return { ...imageKeys, dbKeyHex: across.ok || sessionOnly?.ok ? check.normalized : undefined }
}
