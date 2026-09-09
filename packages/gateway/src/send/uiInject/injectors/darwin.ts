/**
 * macOS injector: CoreGraphics key events for the keystrokes, `osascript … activate` to raise
 * WeChat, `pbcopy` for the clipboard. Ported from AIWC_ORG's wechatWindowTracker.
 *
 * Paste-not-type is deliberate: synthesized key codes cannot produce CJK characters, and
 * `keystroke "<text>"` drops them.
 *
 * Activation cannot trust osascript's exit code: WeChat 4.x ignores the Apple Event `activate` on
 * some builds and osascript still exits 0 while the window never comes forward. Every attempt is
 * therefore verified by re-probing the window list, and we fall through the alternative scripts
 * until one actually works.
 *
 * When CoreGraphics is unavailable (non-mac test runs, a stripped build) everything falls back to
 * System Events keystrokes, which needs Automation permission on top of Accessibility.
 */
import { execFile, spawn } from 'node:child_process'
import { InjectorError, type WeChatInjector } from './types'
import { sleep } from '../../../core/emitter'
import { VK_F, VK_RETURN, VK_V, isTrusted, loadMacNative, probeWeChatWindow, tap } from './macNative'

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
const ACTIVATE_SETTLE_MS = 250

export interface DarwinInjectorDeps {
  run?: (script: string) => Promise<string>
  setClipboard?: (text: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  /** Test seam: force the osascript keystroke path. */
  native?: boolean
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 8000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stderr || error.message}`
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

export function createDarwinInjector(deps: DarwinInjectorDeps = {}): WeChatInjector {
  const run = deps.run ?? runOsascript
  const setClipboard = deps.setClipboard ?? pbcopy
  const wait = deps.sleep ?? sleep
  const useNative = deps.native ?? loadMacNative() !== null

  const isFrontmost = async (): Promise<boolean> => {
    if (useNative) return probeWeChatWindow().frontmost
    try {
      return /wechat|微信/i.test(await run(FRONTMOST_SCRIPT))
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
  const requireReady = (): void => {
    if (!useNative) return
    if (!isTrusted()) throw new InjectorError('no-permission')
    if (!probeWeChatWindow().found) throw new InjectorError('no-window')
  }

  const activate = async (): Promise<void> => {
    if (await isFrontmost()) return
    for (const script of ACTIVATE_SCRIPTS) {
      try {
        await run(script)
      } catch (err) {
        if (err instanceof InjectorError) throw err
        continue
      }
      await wait(ACTIVATE_SETTLE_MS)
      if (await isFrontmost()) return
    }
    throw new InjectorError('focus-failed')
  }

  const keystroke = (key: string, modifiers: string[] = []) => {
    const using = modifiers.length ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}` : ''
    return run(`tell application "System Events" to keystroke "${key}"${using}`)
  }

  const pressCommandF = async () => (useNative ? tap(VK_F, true) : void (await keystroke('f', ['command'])))
  const pressCommandV = async () => (useNative ? tap(VK_V, true) : void (await keystroke('v', ['command'])))
  const pressReturn = async () => (useNative ? tap(VK_RETURN) : void (await run('tell application "System Events" to key code 36')))

  return {
    async focusSession(name) {
      requireReady()
      await activate()
      await setClipboard(name)
      await pressCommandF()
      await wait(SEARCH_OPEN_MS)
      await pressCommandV()
      await wait(SEARCH_RESULT_MS)
      await pressReturn() // open the first search result
      await wait(AFTER_JUMP_MS)
      if (!(await isFrontmost())) throw new InjectorError('focus-failed')
    },
    async fill(text) {
      requireReady()
      if (!(await isFrontmost())) throw new InjectorError('focus-failed')
      await setClipboard(text)
      await wait(80)
      await pressCommandV()
      await wait(pasteSettleMs(text))
    },
    async commit() {
      requireReady()
      if (!(await isFrontmost())) throw new InjectorError('focus-failed')
      await pressReturn()
    },
  }
}
