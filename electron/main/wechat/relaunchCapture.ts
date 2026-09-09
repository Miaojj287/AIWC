/**
 * Last-resort macOS db-key capture: restart WeChat and scan the fresh login process.
 *
 * The common paths (live read-only scan + crash-dump scan) run first inside `acquireKeys`; this is
 * injected as `relaunchCapture` and only fires when both miss (no dump yet AND the live scan was
 * denied or empty). Only the main process may kill/relaunch WeChat, so it lives here rather than in
 * the pure @aiwc/substrate package. On WeChat 4.1.x the key is not derived through CommonCrypto, so
 * there is no LLDB breakpoint to hit — the reliable capture is the read-only memory helper against
 * the freshly-relaunched process (which re-materialises the key during login), plus a dump recheck.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { scanMacDbKey, scanMacDbKeyFromDumps, findWeChatPidSync } from '@aiwc/substrate'
import type { Logger } from '../log'

const execFileAsync = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RelaunchCaptureDeps {
  nativeDir: string
  logger: Logger
  onStatus?: (message: string) => void
}

export type RelaunchCapture = (input: { sessionDb: string; timeoutMs: number }) => Promise<string | undefined>

export function createRelaunchCapture(deps: RelaunchCaptureDeps): RelaunchCapture {
  return async ({ sessionDb, timeoutMs }) => {
    if (process.platform !== 'darwin') return undefined
    const log = deps.logger.child('wechat:relaunch')
    const budget = Math.max(45_000, timeoutMs)
    const deadline = Date.now() + budget

    try {
      deps.onStatus?.('正在关闭微信…')
      await execFileAsync('/usr/bin/pkill', ['-x', 'WeChat']).catch(() => undefined)
      await sleep(2000)
      deps.onStatus?.('正在重新启动微信…')
      await execFileAsync('/usr/bin/open', ['-a', 'WeChat']).catch(() => undefined)

      let pid = 0
      while (Date.now() < deadline) {
        const p = findWeChatPidSync()
        if (p) {
          pid = p
          break
        }
        await sleep(500)
      }
      if (!pid) {
        log.warn('WeChat did not reappear after relaunch')
        return undefined
      }

      deps.onStatus?.('微信已重启，正在捕获启动阶段密钥（如停在登录页请扫码并进入任意聊天）…')
      while (Date.now() < deadline) {
        const remaining = Math.max(8_000, deadline - Date.now())
        const live = await scanMacDbKey(pid, sessionDb, deps.nativeDir, Math.min(20_000, remaining))
        if (live.key) return live.key
        const dump = await scanMacDbKeyFromDumps(sessionDb, deps.nativeDir, Math.min(20_000, remaining))
        if (dump.key) return dump.key
        await sleep(1500)
        const next = findWeChatPidSync()
        if (next) pid = next
      }
      log.warn('relaunch capture exhausted its budget without a key')
      return undefined
    } catch (e) {
      log.warn('relaunch capture failed', e)
      return undefined
    }
  }
}
