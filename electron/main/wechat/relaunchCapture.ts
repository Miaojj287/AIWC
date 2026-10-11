/**
 * Last-resort macOS db-key capture: restart WeChat and read the key from the fresh login.
 *
 * Injected into `acquireKeys` as `relaunchCapture`; it only runs after the read-only scans and the
 * login hook missed. Only the main process may quit / start WeChat, so it lives here rather than in
 * the pure @aiwc/substrate package. Stages are reported as phases (closing_wechat → launching_wechat
 * → waiting_relaunch_login with a deadline) so the UI can tell the user to log in.
 *
 * Invariant: once this has quit WeChat, WeChat is running again when it returns — on success, on
 * timeout, on cancel and on any error (the `finally` below). Leaving the user without WeChat was the
 * worst failure of the old version (it `open`ed the app while the old instance was still exiting).
 */
import type { RelaunchCapture } from '@aiwc/substrate'
import type { Logger } from '../log'
import type { WeChatControl } from './wechatProcess'

/** Budget of one read-only scan of the relaunched process. */
const SCAN_SLICE_MS = 20_000
/** Pause between scan rounds while the user logs in. */
const RESCAN_INTERVAL_MS = 1_500

interface ScanResult {
  key?: string
}

export interface RelaunchCaptureDeps {
  control: WeChatControl
  scanLive(pid: number, sessionDb: string, timeoutMs: number, signal?: AbortSignal): Promise<ScanResult>
  scanDumps(sessionDb: string, timeoutMs: number, signal?: AbortSignal): Promise<ScanResult>
  findPid(): number | null
  logger: Logger
  /** Injected in tests; the capture only exists on macOS. */
  platform?: NodeJS.Platform
  now?: () => number
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export function createRelaunchCapture(deps: RelaunchCaptureDeps): RelaunchCapture {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? abortableSleep
  const log = deps.logger.child('wechat:relaunch')

  return async ({ sessionDb, timeoutMs, signal, onPhase }) => {
    if ((deps.platform ?? process.platform) !== 'darwin') return {}
    let touched = false
    try {
      onPhase('closing_wechat')
      touched = true
      if (!(await deps.control.quit())) {
        log.warn('WeChat did not quit; not restarting it')
        return { failure: 'wechat_relaunch_failed' }
      }
      if (signal?.aborted) return { failure: 'cancelled' }

      onPhase('launching_wechat')
      let pid = await deps.control.launch()
      if (!pid) {
        // launch() already retried; a third attempt in `finally` would only keep the user waiting.
        touched = false
        log.warn('WeChat did not come back after relaunch')
        return { failure: 'wechat_relaunch_failed' }
      }
      if (signal?.aborted) return { failure: 'cancelled' }

      const deadline = now() + timeoutMs
      onPhase('waiting_relaunch_login', deadline)
      while (now() < deadline) {
        const slice = Math.min(SCAN_SLICE_MS, Math.max(1_000, deadline - now()))
        const live = await deps.scanLive(pid, sessionDb, slice, signal)
        if (live.key) return { key: live.key }
        if (signal?.aborted) return { failure: 'cancelled' }
        const dump = await deps.scanDumps(sessionDb, slice, signal)
        if (dump.key) return { key: dump.key }
        if (signal?.aborted) return { failure: 'cancelled' }
        await sleep(RESCAN_INTERVAL_MS, signal)
        if (signal?.aborted) return { failure: 'cancelled' }
        pid = deps.findPid() ?? pid
      }
      log.warn('relaunch capture ran out of time without a key')
      return { failure: 'relaunch_timeout' }
    } catch (error) {
      log.warn('relaunch capture failed', error)
      return { failure: signal?.aborted ? 'cancelled' : 'relaunch_timeout' }
    } finally {
      // Whatever happened above, never leave the user without WeChat.
      if (touched && !(await deps.control.ensureRunning().catch(() => false))) {
        log.warn('WeChat is not running after the relaunch capture')
      }
    }
  }
}
