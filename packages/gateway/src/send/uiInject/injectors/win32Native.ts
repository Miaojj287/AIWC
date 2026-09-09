/**
 * Windows native bindings for keyboard injection and WeChat window lookup (ported from AIWC_ORG's
 * wechatWindowTracker). koffi is loaded lazily so importing this module costs nothing elsewhere.
 */
import { createRequire } from 'node:module'

const requireNative = createRequire(import.meta.url)

const GW_HWNDNEXT = 2
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const SW_RESTORE = 9
const KEYEVENTF_KEYUP = 0x0002

export const VK_CONTROL = 0x11
export const VK_MENU = 0x12
export const VK_RETURN = 0x0d
export const VK_F = 0x46
export const VK_V = 0x56

/* eslint-disable @typescript-eslint/no-explicit-any -- koffi is untyped; the surface stays in this file. */
type Any = any

interface Native {
  koffi: Any
  fn: Record<string, Any>
  pidBuf: Any
  rectBuf: Any
  titleBuf: Buffer
}

let cached: Native | null | undefined

export function loadWin32Native(): Native | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    const koffi = requireNative('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    const kernel32 = koffi.load('kernel32.dll')
    cached = {
      koffi,
      fn: {
        GetTopWindow: user32.func('void* GetTopWindow(void* hwnd)'),
        GetWindow: user32.func('void* GetWindow(void* hwnd, uint32 uCmd)'),
        GetWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(void* hwnd, void* pid)'),
        IsWindowVisible: user32.func('bool IsWindowVisible(void* hwnd)'),
        IsIconic: user32.func('bool IsIconic(void* hwnd)'),
        GetWindowTextLengthW: user32.func('int32 GetWindowTextLengthW(void* hwnd)'),
        GetWindowTextW: user32.func('int32 GetWindowTextW(void* hwnd, void* text, int32 maxCount)'),
        GetWindowRect: user32.func('bool GetWindowRect(void* hwnd, void* rect)'),
        GetForegroundWindow: user32.func('void* GetForegroundWindow()'),
        DwmGetWindowAttribute: dwmapi.func('int32 DwmGetWindowAttribute(void* hwnd, uint32 attr, void* rect, uint32 cb)'),
        SetForegroundWindow: user32.func('bool SetForegroundWindow(void* hwnd)'),
        ShowWindow: user32.func('bool ShowWindow(void* hwnd, int32 nCmdShow)'),
        AttachThreadInput: user32.func('bool AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)'),
        keybdEvent: user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
        GetCurrentThreadId: kernel32.func('uint32 GetCurrentThreadId()'),
      },
      pidBuf: koffi.alloc('uint32', 1),
      rectBuf: koffi.alloc('int32', 4),
      titleBuf: Buffer.alloc(512 * 2),
    }
  } catch {
    cached = null
  }
  return cached
}

const address = (n: Native, hwnd: Any): bigint => {
  try {
    return hwnd ? BigInt(n.koffi.address(hwnd)) : 0n
  } catch {
    return 0n
  }
}

function readTitle(n: Native, hwnd: Any): string {
  if (n.fn.GetWindowTextLengthW(hwnd) <= 0) return ''
  n.titleBuf.fill(0)
  n.fn.GetWindowTextW(hwnd, n.titleBuf, 512)
  const end = n.titleBuf.indexOf(0)
  return n.titleBuf.toString('ucs2', 0, end > 0 ? end : n.titleBuf.length).trim()
}

function hasArea(n: Native, hwnd: Any): boolean {
  const ok = n.fn.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, n.rectBuf, 16) === 0 || n.fn.GetWindowRect(hwnd, n.rectBuf)
  if (!ok) return false
  const [left, top, right, bottom] = n.koffi.decode(n.rectBuf, 'int32', 4)
  return right > left && bottom > top
}

/**
 * WeChat's image viewer and media popups are top-level windows owned by the same process, so the
 * main window is identified by its title, never by picking the largest one.
 */
const MAIN_TITLES = new Set(['微信', 'WeChat', 'Weixin'])

export interface Win32Window {
  hwnd: Any
  address: bigint
}

export function findMainWindow(): Win32Window | null {
  const n = loadWin32Native()
  if (!n) return null
  try {
    for (let hwnd = n.fn.GetTopWindow(null); hwnd; hwnd = n.fn.GetWindow(hwnd, GW_HWNDNEXT)) {
      if (!n.fn.IsWindowVisible(hwnd)) continue
      if (!MAIN_TITLES.has(readTitle(n, hwnd))) continue
      if (!hasArea(n, hwnd)) continue
      return { hwnd, address: address(n, hwnd) }
    }
  } catch { /* fall through to "not found" */ }
  return null
}

export function isForeground(target: bigint): boolean {
  const n = loadWin32Native()
  if (!n || !target) return false
  try {
    return address(n, n.fn.GetForegroundWindow()) === target
  } catch {
    return false
  }
}

export function tap(vk: number, withCtrl = false): void {
  const n = loadWin32Native()
  if (!n) return
  if (withCtrl) n.fn.keybdEvent(VK_CONTROL, 0, 0, 0)
  n.fn.keybdEvent(vk, 0, 0, 0)
  n.fn.keybdEvent(vk, 0, KEYEVENTF_KEYUP, 0)
  if (withCtrl) n.fn.keybdEvent(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

/**
 * SetForegroundWindow is subject to the foreground lock: only a process that is already foreground
 * or has just received input may set it, and neither holds while we auto-reply in the background —
 * the call is then silently ignored. Escalate instead of assuming it worked.
 */
export function forceForeground(window: Win32Window): boolean {
  const n = loadWin32Native()
  if (!n) return false
  if (n.fn.IsIconic(window.hwnd)) n.fn.ShowWindow(window.hwnd, SW_RESTORE)
  n.fn.SetForegroundWindow(window.hwnd)
  if (isForeground(window.address)) return true

  // Manufacture one input event to earn the right to set the foreground window. A bare Alt would
  // open the menu bar in a normal app; WeChat is a self-drawn Qt shell with no menu bar, so a
  // press-and-release has no side effect.
  tap(VK_MENU)
  n.fn.SetForegroundWindow(window.hwnd)
  if (isForeground(window.address)) return true

  const target = n.fn.GetWindowThreadProcessId(window.hwnd, null)
  const ours = n.fn.GetCurrentThreadId()
  if (!target || target === ours) return false
  n.fn.AttachThreadInput(ours, target, true)
  try {
    n.fn.SetForegroundWindow(window.hwnd)
  } finally {
    n.fn.AttachThreadInput(ours, target, false)
  }
  return isForeground(window.address)
}
