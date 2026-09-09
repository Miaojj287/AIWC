/**
 * acquireKeys — obtain the db key and image keys for an account, reporting progress through onStep.
 * Steps mirror the KeyAcquireStep contract: db_key → image_xor → image_aes → verify. Every native
 * call has a timeout; a permission failure yields a `failed` step with detail '需要授权' rather than
 * silently prompting for sudo.
 */
import type { KeyAcquireStep } from '@aiwc/protocol'
import { findSessionDbCandidates, resolveAccountDir, resolveDbStoragePath } from '../wcdb/dbFiles'
import { cleanAccountDirName } from '../wcdb/accountUtils'
import { findWeChatPidSync } from '../discovery/processDetect'
import { verifyDbKey } from './sqlcipherPage'
import { validateKeyHexDetailed } from './validateKeyHex'
import { resolveImageKeys } from './imageKeys'
import { captureMacDbKeyViaHook, isSipEnabled, scanMacDbKey, scanMacDbKeyFromDumps, scanMacImageAesKey } from './macosMemoryScanner'
import { scanWindowsDbKey, scanWindowsImageAesKey } from './windowsMemoryScanner'

export interface AcquireKeysOptions {
  dbRoot: string
  wxid: string
  strategy: 'auto' | 'memory_scan'
  nativeDir: string
  onStep: (step: KeyAcquireStep) => void
  /** Overall wall-clock budget for the db-key scan (ms). */
  dbKeyTimeoutMs?: number
  imageKeyTimeoutMs?: number
  /**
   * Host-provided last-resort capture that restarts WeChat and scans the fresh login process for the
   * db key (returns the 64-hex key or undefined). Injected by electron main because only it may kill
   * and relaunch WeChat; the pure package never touches processes on its own.
   */
  relaunchCapture?: (input: { sessionDb: string; timeoutMs: number }) => Promise<string | undefined>
}

export interface AcquireKeysResult {
  dbKeyHex?: string
  imageXorHex?: string
  imageAesHex?: string
  steps: KeyAcquireStep[]
}

const STEP_LABELS: Record<KeyAcquireStep['id'], string> = {
  db_key: '获取数据库密钥',
  image_xor: '获取图片 XOR 密钥',
  image_aes: '获取图片 AES 密钥',
  verify: '校验密钥',
}

class StepTracker {
  readonly steps: KeyAcquireStep[] = []
  private readonly byId = new Map<KeyAcquireStep['id'], KeyAcquireStep>()
  constructor(private readonly onStep: (step: KeyAcquireStep) => void) {}

  private emit(id: KeyAcquireStep['id'], status: KeyAcquireStep['status'], detail?: string): void {
    let step = this.byId.get(id)
    if (!step) {
      step = { id, label: STEP_LABELS[id], status }
      this.byId.set(id, step)
      this.steps.push(step)
    }
    step.status = status
    if (detail !== undefined) step.detail = detail
    this.onStep({ ...step })
  }

  start(id: KeyAcquireStep['id'], detail?: string): void {
    this.emit(id, 'doing', detail)
  }
  done(id: KeyAcquireStep['id'], detail?: string): void {
    this.emit(id, 'done', detail)
  }
  fail(id: KeyAcquireStep['id'], detail: string): void {
    this.emit(id, 'failed', detail)
  }
}

async function acquireDbKey(opts: AcquireKeysOptions, dbStoragePath: string, tracker: StepTracker): Promise<string | undefined> {
  tracker.start('db_key', '正在从微信进程内存中读取密钥')
  const pid = findWeChatPidSync()
  const timeout = opts.dbKeyTimeoutMs ?? 30_000

  if (process.platform === 'darwin') {
    // The helper reads the SQLCipher salt from a concrete session.db, so scan against that file, not
    // the db_storage directory. Order: live read-only scan (freshest, needs the app's debugger grant)
    // → crash-dump scan (reads files only, always available) → optional relaunch capture. The dump
    // fallback ALWAYS runs even when the live scan reports needsAuthorization.
    const sessionDb = findSessionDbCandidates(dbStoragePath)[0]
    if (!sessionDb) {
      tracker.fail('db_key', `未找到 session.db：${dbStoragePath}`)
      return undefined
    }
    let needsAuthorization = false
    if (pid) {
      const live = await scanMacDbKey(pid, sessionDb, opts.nativeDir, timeout)
      if (live.key) {
        tracker.done('db_key', '已从微信进程内存获取密钥')
        return live.key
      }
      if (live.needsAuthorization) needsAuthorization = true
    }
    const dump = await scanMacDbKeyFromDumps(sessionDb, opts.nativeDir, timeout)
    if (dump.key) {
      tracker.done('db_key', '已从微信崩溃转储获取密钥')
      return dump.key
    }
    // Login-time hook capture via the bundled wechat_xkey_helper — the reliable WeChat 4.x macOS
    // path. It attaches to the running process, installs a hook and returns the raw key the next time
    // the user logs in (the helper's status prompts them to re-login). Needs debugger access.
    if (pid) {
      if (await isSipEnabled()) {
        tracker.fail('db_key', 'SIP（系统完整性保护）已开启，无法获取密钥。请关闭 SIP 后重试。')
        return undefined
      }
      const hook = await captureMacDbKeyViaHook(
        pid,
        opts.nativeDir,
        (message) => tracker.start('db_key', message),
        Math.max(timeout, 60_000),
      )
      if (hook.key) {
        tracker.done('db_key', '已在登录时捕获密钥')
        return hook.key
      }
      if (hook.needsAuthorization) needsAuthorization = true
    }
    // Last resort: relaunch WeChat and scan the fresh login process. Only the host (electron main)
    // can restart WeChat, so it injects `relaunchCapture`; the pure package never kills processes.
    if (opts.relaunchCapture) {
      tracker.start('db_key', '正在重启微信以捕获启动阶段密钥…')
      const relaunched = await opts.relaunchCapture({ sessionDb, timeoutMs: timeout }).catch(() => undefined)
      if (relaunched) {
        tracker.done('db_key', '已在微信重启时捕获密钥')
        return relaunched
      }
    }
    tracker.fail(
      'db_key',
      needsAuthorization
        ? '需要授权：请在「系统设置 › 隐私与安全性 › 开发者工具」中允许 AIWC，或关闭 SIP 后重试'
        : pid
          ? '未能从内存或崩溃转储获取密钥，请确认微信已登录并进入任意聊天后重试'
          : '未检测到微信进程，请先登录微信',
    )
    return undefined
  }

  if (process.platform === 'win32') {
    if (!pid) {
      tracker.fail('db_key', '未检测到微信进程，请先登录微信')
      return undefined
    }
    const sessionDb = findSessionDbCandidates(dbStoragePath)[0]
    if (!sessionDb) {
      tracker.fail('db_key', '未找到 session.db')
      return undefined
    }
    const scan = scanWindowsDbKey(pid, sessionDb, Date.now() + timeout)
    if (scan.key) {
      tracker.done('db_key', '已从微信进程内存获取密钥')
      return scan.key
    }
    tracker.fail('db_key', scan.opened ? '内存中未找到匹配的数据库密钥，请在登录后重试' : '无法读取微信进程内存（可能需要管理员权限）')
    return undefined
  }

  tracker.fail('db_key', `不支持的平台: ${process.platform}`)
  return undefined
}

async function acquireImageKeys(opts: AcquireKeysOptions, accountDir: string, tracker: StepTracker): Promise<{ xorHex?: string; aesHex?: string }> {
  tracker.start('image_xor', '正在从模板文件计算 XOR 密钥')
  const wxidCandidates = Array.from(new Set([basenameOf(accountDir), opts.wxid, cleanAccountDirName(opts.wxid)].filter(Boolean)))
  const timeout = opts.imageKeyTimeoutMs ?? 30_000
  const pid = findWeChatPidSync()
  const memoryScan = pid
    ? async (ciphertext: Buffer): Promise<string | null> => {
        tracker.start('image_aes', '正在扫描微信进程内存获取图片 AES 密钥')
        if (process.platform === 'darwin') return scanMacImageAesKey(pid, ciphertext, opts.nativeDir, timeout)
        if (process.platform === 'win32') return scanWindowsImageAesKey(pid, ciphertext, Date.now() + timeout)
        return null
      }
    : undefined

  const result = await resolveImageKeys(accountDir, wxidCandidates, memoryScan)
  if (result.xorHex) tracker.done('image_xor', `XOR 密钥 0x${result.xorHex}`)
  else tracker.fail('image_xor', result.error ?? '未能获取 XOR 密钥')

  tracker.start('image_aes')
  if (result.aesHex) tracker.done('image_aes', '图片 AES 密钥获取成功')
  else tracker.fail('image_aes', result.error ?? '未能获取图片 AES 密钥（可仅使用 XOR 密钥）')
  return { xorHex: result.xorHex, aesHex: result.aesHex }
}

function basenameOf(dir: string): string {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

export async function acquireKeys(opts: AcquireKeysOptions): Promise<AcquireKeysResult> {
  const tracker = new StepTracker(opts.onStep)
  const dbStoragePath = resolveDbStoragePath(opts.dbRoot, opts.wxid)
  const accountDir = resolveAccountDir(opts.dbRoot, opts.wxid)
  if (!dbStoragePath || !accountDir) {
    tracker.fail('db_key', `未找到账号目录或 db_storage：${opts.dbRoot}`)
    return { steps: tracker.steps }
  }

  const dbKeyHex = await acquireDbKey(opts, dbStoragePath, tracker)
  const image = await acquireImageKeys(opts, accountDir, tracker)

  tracker.start('verify')
  if (dbKeyHex) {
    const check = validateKeyHexDetailed(dbKeyHex)
    if (!check.ok) {
      tracker.fail('verify', check.error ?? '密钥格式非法')
      return { steps: tracker.steps, imageXorHex: image.xorHex, imageAesHex: image.aesHex }
    }
    const sessionDb = findSessionDbCandidates(dbStoragePath)[0]
    const verified = sessionDb ? verifyDbKey(sessionDb, dbKeyHex) : { ok: false, error: '未找到 session.db' }
    if (verified.ok) tracker.done('verify', '数据库密钥校验通过')
    else tracker.fail('verify', verified.error ?? '密钥校验失败')
    return {
      steps: tracker.steps,
      dbKeyHex: verified.ok ? check.normalized : undefined,
      imageXorHex: image.xorHex,
      imageAesHex: image.aesHex,
    }
  }
  tracker.fail('verify', '未获取到数据库密钥')
  return { steps: tracker.steps, imageXorHex: image.xorHex, imageAesHex: image.aesHex }
}
