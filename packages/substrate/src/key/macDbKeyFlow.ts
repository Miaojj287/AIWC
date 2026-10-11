/**
 * macOS db-key acquisition order (WeChat 4.x). Each stage reports a distinct phase so the UI can say
 * what is happening, and the final failure names the stage that stopped it:
 *
 *   1. reading_memory  — read-only scan of the running process (needs the Developer Tools grant)
 *   2. reading_dumps   — WeChat's own crash dumps (files only, always allowed)
 *   3. arming_hook → waiting_login — `wechat_xkey_helper` login hook; the user logs out and back in
 *   4. closing_wechat → launching_wechat → waiting_relaunch_login — host-provided relaunch capture
 *
 * `memory_scan` stops after 2 (never touches WeChat). The relaunch is skipped when the OS already
 * denied access to WeChat's memory: restarting it could not help and would only interrupt the user.
 * Dependencies are injected so the ordering and the failure mapping are unit-tested without WeChat.
 */
import type { KeyAcquireFailure, KeyAcquirePhase } from '@aiwc/protocol'
import type { MacHookCaptureOptions, MacHookCaptureResult, MacScanResult } from './macosMemoryScanner'

export interface RelaunchCaptureInput {
  sessionDb: string
  timeoutMs: number
  signal?: AbortSignal
  onPhase: (phase: KeyAcquirePhase, waitUntil?: number) => void
}

export interface RelaunchCaptureResult {
  key?: string
  failure?: Extract<KeyAcquireFailure, 'wechat_relaunch_failed' | 'relaunch_timeout' | 'cancelled'>
}

/** Restarts WeChat and reads the key from the fresh login. Only the host may do this (it kills processes). */
export type RelaunchCapture = (input: RelaunchCaptureInput) => Promise<RelaunchCaptureResult>

export interface MacDbKeyDeps {
  findPid(): number | null | undefined
  scanLive(pid: number, sessionDb: string, timeoutMs: number, signal?: AbortSignal): Promise<MacScanResult>
  scanDumps(sessionDb: string, timeoutMs: number, signal?: AbortSignal): Promise<MacScanResult>
  isSipEnabled(): Promise<boolean>
  captureHook(pid: number, options: MacHookCaptureOptions): Promise<MacHookCaptureResult>
  relaunchCapture?: RelaunchCapture
}

export interface MacDbKeyInput {
  sessionDb: string
  strategy: 'auto' | 'memory_scan'
  /** Budget of each read-only scan. */
  scanTimeoutMs: number
  /** How long the armed login hook waits for the user. */
  hookTimeoutMs: number
  /** How long the relaunch capture waits for the fresh login. */
  relaunchTimeoutMs: number
  signal?: AbortSignal
  onPhase: (phase: KeyAcquirePhase, waitUntil?: number) => void
}

export type MacDbKeyOutcome =
  | { key: string; detail: string; failure?: undefined }
  | { key?: undefined; failure: KeyAcquireFailure | undefined; detail: string }

const needAuthorizationText = '需要授权：请在「系统设置 › 隐私与安全性 › 开发者工具」中允许 AIWC，或关闭 SIP 后重试'
const notFoundText = '未能从内存或崩溃转储获取密钥，请确认微信已登录并进入任意聊天后重试'

const abortError = () => new DOMException('aborted', 'AbortError')

function checkpoint(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function hookFailure(hook: MacHookCaptureResult): KeyAcquireFailure | undefined {
  if (hook.code === 'HOOK_FAILED') return 'login_timeout'
  if (hook.code === 'PROCESS_EXITED' || hook.code === 'PROCESS_NOT_FOUND') return 'wechat_exited'
  return undefined
}

export async function runMacDbKeyFlow(deps: MacDbKeyDeps, input: MacDbKeyInput): Promise<MacDbKeyOutcome> {
  const { sessionDb, signal, onPhase } = input
  let denied = false
  const pid = deps.findPid()

  if (pid) {
    onPhase('reading_memory')
    const live = await deps.scanLive(pid, sessionDb, input.scanTimeoutMs, signal)
    if (live.key) return { key: live.key, detail: '已从微信进程内存获取密钥' }
    if (live.needsAuthorization) denied = true
  }
  checkpoint(signal)

  onPhase('reading_dumps')
  const dump = await deps.scanDumps(sessionDb, input.scanTimeoutMs, signal)
  if (dump.key) return { key: dump.key, detail: '已从微信崩溃转储获取密钥' }
  checkpoint(signal)

  if (input.strategy === 'memory_scan') {
    if (denied) return { failure: 'needs_authorization', detail: needAuthorizationText }
    if (!pid) return { failure: 'wechat_not_running', detail: '未检测到微信进程，请先登录微信' }
    return { failure: 'not_found', detail: notFoundText }
  }

  // Login-time hook capture — the reliable WeChat 4.x path. Needs debugger access, so SIP blocks it.
  const sip = pid && !denied ? await deps.isSipEnabled() : false
  let hookResult: { failure?: KeyAcquireFailure; detail?: string } = {}
  if (pid && !denied && !sip) {
    onPhase('arming_hook')
    const hook = await deps.captureHook(pid, {
      timeoutMs: input.hookTimeoutMs,
      signal,
      onArmed: (waitUntil) => onPhase('waiting_login', waitUntil),
    })
    if (hook.key) return { key: hook.key, detail: '已在登录时捕获密钥' }
    checkpoint(signal)
    if (hook.needsAuthorization) denied = true
    else hookResult = { failure: hookFailure(hook), detail: hook.error }
  }
  checkpoint(signal)

  let relaunchFailure: RelaunchCaptureResult['failure']
  if (deps.relaunchCapture && !denied) {
    const relaunched = await deps.relaunchCapture({
      sessionDb,
      timeoutMs: input.relaunchTimeoutMs,
      signal,
      onPhase,
    })
    if (relaunched.key) return { key: relaunched.key, detail: '已在微信重启时捕获密钥' }
    checkpoint(signal)
    relaunchFailure = relaunched.failure
  }

  // Name the most actionable reason: access denied → WeChat gone → the hook wait → SIP → relaunch.
  if (denied) return { failure: 'needs_authorization', detail: needAuthorizationText }
  if (relaunchFailure === 'wechat_relaunch_failed') return { failure: relaunchFailure, detail: notFoundText }
  if (hookResult.failure) return { failure: hookResult.failure, detail: hookResult.detail ?? notFoundText }
  if (sip) return { failure: 'sip_enabled', detail: 'SIP（系统完整性保护）已开启，无法获取密钥。请关闭 SIP 后重试。' }
  if (relaunchFailure) return { failure: relaunchFailure, detail: notFoundText }
  if (!pid) return { failure: 'wechat_not_running', detail: '未检测到微信进程，请先登录微信' }
  return { failure: hookResult.detail ? 'unexpected' : 'not_found', detail: hookResult.detail ?? notFoundText }
}
