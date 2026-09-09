/**
 * macOS db-key acquisition. WeChat's raw account key only lives in memory during login, so the
 * bundled `wechat_memory_scan_helper` (read-only Mach VM scan) is the primary source; we also try
 * WeChat's own crash dumps. Everything is spawned with an explicit timeout and never uses sudo —
 * a task_for_pid failure surfaces as `needsAuthorization` so the UI can guide the user.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { resolveOptionalNative } from '../wcdb/nativeLib'
import { isValidKeyHex } from './sqlcipherPage'

const execFileAsync = promisify(execFile)

export interface MacScanResult {
  key?: string
  needsAuthorization?: boolean
  error?: string
}

interface HelperPayload {
  success?: boolean
  key?: string
  attached?: boolean
  attachCode?: number
}

function helperPath(nativeDir: string): string | null {
  return resolveOptionalNative(nativeDir, 'wechat_memory_scan_helper', 'AIWC_WX_MEMORY_HELPER_PATH')
}

function parseHelperPayload(stdout: string): HelperPayload | null {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
  if (!line) return null
  try {
    return JSON.parse(line) as HelperPayload
  } catch {
    return null
  }
}

async function runHelper(helper: string, args: string[], timeoutMs: number): Promise<HelperPayload | null> {
  try {
    const { stdout } = await execFileAsync(helper, args, { timeout: Math.max(10_000, timeoutMs), maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' })
    return parseHelperPayload(stdout)
  } catch (error) {
    // A completed scan with no match exits non-zero but still prints its JSON payload.
    const stdout = typeof (error as { stdout?: string })?.stdout === 'string' ? (error as { stdout: string }).stdout : ''
    return parseHelperPayload(stdout)
  }
}

function toKey(payload: HelperPayload | null): string | undefined {
  const key = payload?.key
  return typeof key === 'string' && isValidKeyHex(key) ? key.toLowerCase() : undefined
}

function crashDumpDir(): string {
  return join(homedir(), 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'app_data', 'crashinfo', 'completed')
}

/**
 * Live read-only scan of WeChat's process memory via the bundled helper.
 * `sessionDbPath` MUST be a concrete `session.db` file (not the db_storage dir): the helper reads
 * its SQLCipher salt from that file's first page and only returns a key that decrypts it. The live
 * scan needs task_for_pid, which the packaged app gets from the `com.apple.security.cs.debugger`
 * entitlement + the user's "Developer Tools" grant; unsigned dev runs fall back to the crash dump.
 */
export async function scanMacDbKey(pid: number, sessionDbPath: string, nativeDir: string, timeoutMs = 25_000): Promise<MacScanResult> {
  const helper = helperPath(nativeDir)
  if (!helper) return { error: '缺少 wechat_memory_scan_helper' }
  if (!Number.isInteger(pid) || pid <= 0) return { error: '未找到微信进程' }
  const payload = await runHelper(helper, [String(pid), sessionDbPath], timeoutMs)
  const key = toKey(payload)
  if (key) return { key }
  // attachCode set (and not attached) means task_for_pid was denied → user must authorize / disable SIP.
  if (payload && payload.attached === false && typeof payload.attachCode === 'number' && payload.attachCode !== 0) {
    return { needsAuthorization: true, error: '需要授权（无法附加到微信进程，请在系统设置中授予权限或关闭 SIP）' }
  }
  return {}
}

/**
 * WeChat crash dumps can retain the key even after the login window closes. This path reads dump
 * FILES only (no task_for_pid), so it works in an unsigned dev build and is the reliable fallback
 * when the live scan is denied. `sessionDbPath` is the concrete session.db used to validate matches.
 */
export async function scanMacDbKeyFromDumps(sessionDbPath: string, nativeDir: string, timeoutMs = 30_000): Promise<MacScanResult> {
  const helper = helperPath(nativeDir)
  if (!helper) return { error: '缺少 wechat_memory_scan_helper' }
  const dumpPath = crashDumpDir()
  if (!existsSync(dumpPath)) return {}
  const payload = await runHelper(helper, ['--dump', dumpPath, sessionDbPath], timeoutMs)
  const key = toKey(payload)
  return key ? { key } : {}
}

/** Read-only image AES scan (`--image <pid> <ciphertext-hex>`); returns the 16-char ASCII key. */
export async function scanMacImageAesKey(pid: number, ciphertext: Buffer, nativeDir: string, timeoutMs = 30_000): Promise<string | null> {
  const helper = helperPath(nativeDir)
  if (!helper || ciphertext.length < 16 || pid <= 0) return null
  try {
    const { stdout } = await execFileAsync(helper, ['--image', String(pid), ciphertext.subarray(0, 16).toString('hex')], {
      timeout: Math.max(10_000, timeoutMs),
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    const payload = parseHelperPayload(stdout) as { success?: boolean; aesKeyHex?: string } | null
    const keyHex = payload?.aesKeyHex
    if (payload?.success && typeof keyHex === 'string' && /^[0-9a-fA-F]{32}$/.test(keyHex)) {
      return Buffer.from(keyHex, 'hex').toString('ascii')
    }
  } catch {
    // helper unavailable / timed out
  }
  return null
}

/* ------------------------------------------------------ login-time hook capture */

export interface MacHookCaptureResult {
  key?: string
  /** helper error code (ATTACH_FAILED / PROCESS_NOT_FOUND / SCAN_FAILED / HOOK_FAILED / …). */
  code?: string
  error?: string
  /** true when the failure is a denied attach — the user must disable SIP / grant debugger access. */
  needsAuthorization?: boolean
}

function xkeyHelperPath(nativeDir: string): string | null {
  return resolveOptionalNative(nativeDir, 'wechat_xkey_helper', 'AIWC_WX_XKEY_HELPER_PATH')
}

/** Extract a 64-hex key from any JSON `{success,key}` fragment the helper prints. */
function extractHookKeyFromJson(output: string): string | undefined {
  const re = /\{[^{}]*\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(output)) !== null) {
    try {
      const payload = JSON.parse(match[0]) as { success?: boolean; key?: string }
      if (payload?.success === true && typeof payload.key === 'string' && isValidKeyHex(payload.key)) {
        return payload.key.toLowerCase()
      }
    } catch {
      // ignore malformed fragments
    }
  }
  return undefined
}

/** Parse the helper's terminal line: a bare 64-hex key, or `ERROR:CODE:detail`. */
function parseHookResult(raw: string): { key?: string; code?: string; detail?: string } {
  const text = raw.trim()
  if (!text) return { code: 'UNKNOWN' }
  const fromJson = extractHookKeyFromJson(text)
  if (fromJson) return { key: fromJson }
  const lastLine = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? ''
  if (isValidKeyHex(lastLine)) return { key: lastLine.toLowerCase() }
  if (lastLine.startsWith('ERROR:')) {
    const parts = lastLine.split(':')
    return { code: parts[1] || 'UNKNOWN', detail: parts.slice(2).join(':') || undefined }
  }
  return { code: 'UNKNOWN', detail: lastLine || undefined }
}

function mapHookError(code?: string, detail?: string): string {
  if (code === 'PROCESS_NOT_FOUND') return '微信主进程未运行'
  if (code === 'ATTACH_FAILED') return `无法附加微信进程（${detail || 'operation not permitted'}）。请关闭 SIP 或授予调试权限后重试。`
  if (code === 'SCAN_FAILED') return `未定位到目标函数（${detail || 'sink pattern not found'}）`
  if (code === 'HOOK_FAILED') return `已定位目标，但等待超时（${detail || 'hook timeout'}）。请在提示出现后登录微信或退出后重新登录。`
  if (code === 'HOOK_TARGET_ONLY') return `仅定位到目标地址，尚未捕获到最终密钥（${detail || ''}）`
  return detail ? `${code || 'UNKNOWN'}：${detail}` : '密钥获取失败'
}

/**
 * Login-time db-key capture via the bundled `wechat_xkey_helper`. This is the reliable macOS path:
 * WeChat 4.x derives the raw account key at login, so the helper attaches to the running process,
 * installs a hook, and returns the key the next time the user logs in (or logs out then back in).
 *
 * It needs debugger access (SIP disabled, or the packaged app's debugger entitlement + Developer
 * Tools grant). `onStatus` fires with the interim messages so the UI can prompt the user to log in;
 * `hook installed` on the helper's stderr means it is armed and waiting.
 */
export async function captureMacDbKeyViaHook(
  pid: number,
  nativeDir: string,
  onStatus?: (message: string) => void,
  timeoutMs = 60_000,
): Promise<MacHookCaptureResult> {
  if (process.platform !== 'darwin') return { error: 'macOS only' }
  const helper = xkeyHelperPath(nativeDir)
  if (!helper) return { error: '缺少 wechat_xkey_helper' }
  if (!Number.isInteger(pid) || pid <= 0) return { code: 'PROCESS_NOT_FOUND', error: '未找到微信主进程' }
  const waitMs = Math.max(timeoutMs, 30_000)

  onStatus?.(`已找到微信进程 PID=${pid}，正在安装挂钩…`)
  return await new Promise<MacHookCaptureResult>((resolve) => {
    const child = spawn(helper, [String(pid), String(waitMs)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let stderrBuf = ''
    let settled = false
    const finish = (result: MacHookCaptureResult) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve(result)
    }
    const onHelperLine = (line: string) => {
      if (line.includes('hook installed')) onStatus?.('已准备就绪，现在登录微信，或退出登录后重新登录微信')
    }
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      const data = chunk.toString()
      stderr += data
      stderrBuf += data
      const parts = stderrBuf.split(/\r?\n/)
      stderrBuf = parts.pop() || ''
      for (const line of parts) onHelperLine(line.trim())
    })
    child.on('error', (error) => finish({ error: error instanceof Error ? error.message : String(error) }))
    child.on('close', () => {
      if (stderrBuf.trim()) onHelperLine(stderrBuf.trim())
      const parsed = parseHookResult(stdout || stderr)
      if (parsed.key) {
        finish({ key: parsed.key })
        return
      }
      const needsAuthorization = parsed.code === 'ATTACH_FAILED'
      finish({ code: parsed.code, needsAuthorization, error: mapHookError(parsed.code, parsed.detail) })
    })
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
    }, waitMs + 10_000)
  })
}

/** macOS System Integrity Protection status; the hook capture needs it disabled (or a signed helper). */
export async function isSipEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/csrutil', ['status'], { timeout: 5_000 })
    return stdout.toLowerCase().includes('enabled')
  } catch {
    return false
  }
}
