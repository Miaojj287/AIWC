/**
 * macOS injector: CoreGraphics key events for the keystrokes, `osascript … activate` to raise
 * WeChat, `pbcopy` for the clipboard. Ported from AIWC_ORG's wechatWindowTracker.
 *
 * Paste-not-type is deliberate: synthesized key codes cannot produce CJK characters, and
 * `keystroke "<text>"` drops them.
 *
 * Activation cannot trust osascript's exit code: WeChat 4.x ignores the Apple Event `activate` on
 * some builds and osascript still exits 0 while the window never comes forward. Every attempt is
 * therefore verified using the system foreground process and the WeChat window list. Launch
 * Services reopens hidden/minimized windows first; Apple Events are bounded fallback attempts.
 *
 * When CoreGraphics is unavailable (non-mac test runs, a stripped build) everything falls back to
 * System Events keystrokes, which needs Automation permission on top of Accessibility.
 */
import { execFile, spawn } from 'node:child_process'
import { InjectorError, type WeChatInjector } from './types'
import { sleep } from '../../../core/emitter'
import { VK_F, VK_RETURN, VK_V, isTrusted, loadMacNative, probeWeChatWindow, tap, type WeChatWindowState } from './macNative'

const WECHAT_BUNDLE_ID = 'com.tencent.xinWeChat'
const ACTIVATE_SCRIPTS = [
  `tell application id "${WECHAT_BUNDLE_ID}" to activate`,
  'tell application "WeChat" to activate',
  'tell application "System Events" to tell process "WeChat" to set frontmost to true',
  'tell application "System Events" to tell process "微信" to set frontmost to true',
]
const FRONTMOST_SCRIPT = 'tell application "System Events" to get name of first application process whose frontmost is true'
/**
 * WeChat finishes the paste asynchronously; pressing Return before it lands hits an empty composer
 * and the text shows up afterwards — which reads as "sometimes it just does not send". The cost
 * scales with how much text the composer has to lay out, so the wait does too: a fixed 350ms was
 * comfortable for a one-line reply and marginal for a three-sentence one.
 */
const PASTE_SETTLE_BASE_MS = 350
const PASTE_SETTLE_PER_CHAR_MS = 6
const PASTE_SETTLE_MAX_MS = 1200
const pasteSettleMs = (text: string): number =>
  Math.min(PASTE_SETTLE_MAX_MS, PASTE_SETTLE_BASE_MS + [...text].length * PASTE_SETTLE_PER_CHAR_MS)
const SEARCH_OPEN_MS = 220
const SEARCH_RESULT_MS = 650
const AFTER_JUMP_MS = 450
const ACTIVATE_SETTLE_MS = 150
const ACTIVATE_POLLS = 10

export interface DarwinInjectorDeps {
  run?: (script: string) => Promise<string>
  setClipboard?: (text: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  /** Test seam: force the osascript keystroke path. */
  native?: boolean
  probeWindow?: () => WeChatWindowState
  trusted?: () => boolean
  launch?: () => Promise<void>
  logger?: (level: 'debug' | 'warn', message: string, meta?: unknown) => void
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 8000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stderr || error.message}`
        if (/not authorized to send Apple events|-1743/.test(detail)) return reject(new InjectorError('automation-denied', detail))
        if (/not allowed assistive access|1002|-25211/.test(detail)) return reject(new InjectorError('no-permission', detail))
        return reject(new Error(detail))
      }
      resolve(String(stdout).trim())
    })
  })
}

function pbcopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pbcopy')
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exited ${code}`))))
    child.stdin.end(text, 'utf8')
  })
}

function openWeChat(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-b', WECHAT_BUNDLE_ID], { timeout: 8000 }, (error) => error ? reject(error) : resolve())
  })
}

function createFocusController(deps: DarwinInjectorDeps) {
  const run = deps.run ?? runOsascript
  const wait = deps.sleep ?? sleep
  const useNative = deps.native ?? loadMacNative() !== null

  const probe = deps.probeWindow ?? probeWeChatWindow
  const trusted = deps.trusted ?? isTrusted
  const log = deps.logger ?? (() => {})
  const isFrontmost = async (): Promise<boolean> => {
    if (useNative) return probe().frontmost
    try {
      return /^(WeChat|微信|Weixin)$/i.test(await run(FRONTMOST_SCRIPT))
    } catch (err) {
      // A denied permission must not be reported as "the window would not come forward" — the user
      // would go hunting for WeChat instead of ticking the box that actually fixes it.
      if (err instanceof InjectorError) throw err
      return false
    }
  }

  /**
   * Accessibility permission is checked before anything else: without it macOS silently discards
   * every synthesized event while reporting success, so the only visible symptom would be a message
   * that never arrives. Better to say what to switch on.
   */
  const requireReady = (requireWindow = true): void => {
    if (!useNative) return
    if (!trusted()) throw new InjectorError('no-permission')
    if (requireWindow && !probe().found) throw new InjectorError('no-window')
  }

  const requireFrontmost = async (stage: string): Promise<void> => {
    if (await isFrontmost()) return
    log('warn', 'wechat focus check failed', { stage, ...(useNative ? probe() : {}) })
    throw new InjectorError('focus-failed')
  }
  const activate = async (): Promise<void> => {
    // A hidden/minimized window is absent from the on-screen list; try reopening before no-window.
    requireReady(false)
    if (await isFrontmost()) return
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['open-bundle', deps.launch ?? openWeChat],
      ...ACTIVATE_SCRIPTS.map((script, i): [string, () => Promise<unknown>] => [`applescript-${i + 1}`, () => run(script)]),
    ]
    let permissionError: InjectorError | undefined
    for (const [method, perform] of attempts) {
      try {
        await perform()
      } catch (err) {
        if (err instanceof InjectorError) permissionError = err
        log('warn', 'wechat activation attempt failed', { method, error: err instanceof Error ? err.message : String(err) })
        continue
      }
      for (let poll = 0; poll < ACTIVATE_POLLS; poll++) {
        await wait(ACTIVATE_SETTLE_MS)
        if (await isFrontmost()) {
          log('debug', 'wechat activation verified', { method, poll, ...(useNative ? probe() : {}) })
          return
        }
      }
      log('warn', 'wechat activation not verified', { method, ...(useNative ? probe() : {}) })
    }
    if (permissionError) throw permissionError
    requireReady()
    throw new InjectorError('focus-failed')
  }
  return { activate, requireReady, requireFrontmost }
}

/** Activation-only diagnostic: never searches, writes the clipboard or sends a message. */
export async function activateWeChatWindow(deps: DarwinInjectorDeps = {}): Promise<void> {
  await createFocusController(deps).activate()
}

export function createDarwinInjector(deps: DarwinInjectorDeps = {}): WeChatInjector {
  const run = deps.run ?? runOsascript
  const setClipboard = deps.setClipboard ?? pbcopy
  const wait = deps.sleep ?? sleep
  const useNative = deps.native ?? loadMacNative() !== null
  const { activate, requireReady, requireFrontmost } = createFocusController(deps)

  const keystroke = (key: string, modifiers: string[] = []) => {
    const using = modifiers.length ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}` : ''
    return run(`tell application "System Events" to keystroke "${key}"${using}`)
  }

  const pressCommandF = async () => (useNative ? tap(VK_F, true) : void (await keystroke('f', ['command'])))
  const pressCommandV = async () => (useNative ? tap(VK_V, true) : void (await keystroke('v', ['command'])))
  const pressReturn = async () => (useNative ? tap(VK_RETURN) : void (await run('tell application "System Events" to key code 36')))

  return {
    async focusSession(name) {
      await activate()
      requireReady()
      await setClipboard(name)
      await requireFrontmost('search-open')
      await pressCommandF()
      await wait(SEARCH_OPEN_MS)
      await requireFrontmost('search-paste')
      await pressCommandV()
      await wait(SEARCH_RESULT_MS)
      await requireFrontmost('search-result')
      await pressReturn() // open the first search result
      await wait(AFTER_JUMP_MS)
      await requireFrontmost('search-complete')
    },
    async fill(text) {
      requireReady()
      await requireFrontmost('fill-start')
      await setClipboard(text)
      await wait(80)
      await requireFrontmost('fill-paste')
      await pressCommandV()
      await wait(pasteSettleMs(text))
    },
    async commit() {
      requireReady()
      await requireFrontmost('commit')
      await pressReturn()
    },
  }
}
