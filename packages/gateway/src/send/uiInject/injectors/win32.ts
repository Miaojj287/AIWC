/**
 * Windows injector: koffi + user32 for window lookup, foreground escalation and keystrokes;
 * PowerShell only for the clipboard. Ported from AIWC_ORG's wechatWindowTracker.
 *
 * Clipboard + Ctrl+V instead of typing — synthesized key codes cannot produce CJK characters.
 *
 * When koffi is unavailable everything falls back to WScript.Shell AppActivate + SendKeys, which
 * works when WeChat is already interactive but loses to the foreground lock in the background.
 */
import { execFile } from 'node:child_process'
import { InjectorError, type WeChatInjector } from './types'
import { sleep } from '../../../core/emitter'
import { VK_F, VK_RETURN, VK_V, findMainWindow, forceForeground, isForeground, loadWin32Native, tap, type Win32Window } from './win32Native'

const WINDOW_TITLES = ['微信', 'WeChat', 'Weixin']
/** Scales with the text length for the same reason as the macOS injector (see darwin.ts). */
const PASTE_SETTLE_BASE_MS = 200
const PASTE_SETTLE_PER_CHAR_MS = 6
const PASTE_SETTLE_MAX_MS = 1200
const pasteSettleMs = (text: string): number =>
  Math.min(PASTE_SETTLE_MAX_MS, PASTE_SETTLE_BASE_MS + [...text].length * PASTE_SETTLE_PER_CHAR_MS)
const SEARCH_OPEN_MS = 180
const SEARCH_RESULT_MS = 650
const AFTER_JUMP_MS = 450
const AFTER_FOCUS_MS = 120

export interface Win32InjectorDeps {
  run?: (script: string, stdin?: string) => Promise<string>
  sleep?: (ms: number) => Promise<void>
  /** Test seam: force the SendKeys path. */
  native?: boolean
}

function runPowerShell(script: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${stderr || error.message}`))
      resolve(String(stdout).trim())
    })
    if (stdin !== undefined && child.stdin) child.stdin.end(stdin, 'utf8')
    else child.stdin?.end()
  })
}

const SENDKEYS_PRELUDE = 'Add-Type -AssemblyName System.Windows.Forms;'

export function createWin32Injector(deps: Win32InjectorDeps = {}): WeChatInjector {
  const run = deps.run ?? runPowerShell
  const wait = deps.sleep ?? sleep
  const useNative = deps.native ?? loadWin32Native() !== null

  const setClipboard = (text: string) => run('$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t', text)
  const sendKeys = (keys: string) => run(`${SENDKEYS_PRELUDE} [System.Windows.Forms.SendKeys]::SendWait('${keys}')`)

  /** The main window is re-resolved on every step: WeChat recreates it across restarts. */
  let current: Win32Window | null = null

  const resolve = (): Win32Window => {
    const found = findMainWindow()
    if (!found) throw new InjectorError('no-window')
    current = found
    return found
  }

  const stillFront = async (): Promise<boolean> => {
    if (useNative) return Boolean(current && isForeground(current.address))
    const script = [
      'Add-Type @"',
      'using System; using System.Runtime.InteropServices; using System.Text;',
      'public class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }',
      '"@;',
      '$h = [FG]::GetForegroundWindow(); $sb = New-Object System.Text.StringBuilder 256; [FG]::GetWindowText($h, $sb, 256) | Out-Null; $sb.ToString()',
    ].join('\n')
    try {
      const title = await run(script)
      return WINDOW_TITLES.some((t) => title.includes(t))
    } catch {
      return false
    }
  }

  const activate = async (): Promise<void> => {
    if (useNative) {
      if (!forceForeground(resolve())) throw new InjectorError('focus-failed')
      await wait(AFTER_FOCUS_MS)
      return
    }
    for (const title of WINDOW_TITLES) {
      const out = await run(`(New-Object -ComObject WScript.Shell).AppActivate('${title}')`)
      if (/true/i.test(out)) {
        await wait(AFTER_FOCUS_MS)
        return
      }
    }
    throw new InjectorError('no-window')
  }

  const pressCtrlF = async () => (useNative ? tap(VK_F, true) : void (await sendKeys('^f')))
  const pressCtrlV = async () => (useNative ? tap(VK_V, true) : void (await sendKeys('^v')))
  const pressReturn = async () => (useNative ? tap(VK_RETURN) : void (await sendKeys('{ENTER}')))

  return {
    async focusSession(name) {
      await activate()
      await setClipboard(name)
      await pressCtrlF()
      await wait(SEARCH_OPEN_MS)
      await pressCtrlV()
      await wait(SEARCH_RESULT_MS)
      await pressReturn() // open the first search result
      await wait(AFTER_JUMP_MS)
      if (!(await stillFront())) throw new InjectorError('focus-failed')
    },
    async fill(text) {
      if (!(await stillFront())) throw new InjectorError('focus-failed')
      await setClipboard(text)
      await wait(60)
      await pressCtrlV()
      await wait(pasteSettleMs(text))
    },
    async commit() {
      if (!(await stillFront())) throw new InjectorError('focus-failed')
      await pressReturn()
    },
  }
}
