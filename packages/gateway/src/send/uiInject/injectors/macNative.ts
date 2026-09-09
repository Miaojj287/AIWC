/**
 * macOS native bindings for keyboard injection and WeChat window probing (ported from AIWC_ORG's
 * wechatWindowTracker). Everything is loaded lazily through koffi so importing this module on a
 * machine without CoreGraphics — or in a unit test — costs nothing and throws nothing.
 *
 * Why CGEvent rather than `osascript … keystroke`:
 *  - AXIsProcessTrusted() tells us up-front whether the injection will land. Without Accessibility
 *    permission macOS drops synthesized events silently and every call still reports success, so
 *    the only symptom is "the message never got sent".
 *  - one CGEventPost costs nothing; each osascript is a process spawn, and the paste/Enter timing
 *    here is measured in tens of milliseconds.
 *  - CGWindowList answers "is WeChat running / frontmost" without System Events, which needs its
 *    own (separate, easily-denied) Automation permission.
 */
import { createRequire } from 'node:module'

const requireNative = createRequire(import.meta.url)

/** kCGHIDEventTap — inject at the HID layer, indistinguishable from a real keyboard. */
const HID_EVENT_TAP = 0
/** kCGEventFlagMaskCommand */
const FLAG_COMMAND = 0x100000
const CF_STRING_ENCODING_UTF8 = 0x08000100
const CF_NUMBER_DOUBLE_TYPE = 13
/** kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements */
const WINDOW_LIST_OPTIONS = 0x0001 | 0x0010
const NORMAL_WINDOW_LAYER = 0

/** mac virtual key codes: kVK_ANSI_F / kVK_ANSI_V / kVK_Return */
export const VK_F = 0x03
export const VK_V = 0x09
export const VK_RETURN = 0x24

/* eslint-disable @typescript-eslint/no-explicit-any -- koffi is untyped; the surface stays in this file. */
type Any = any

interface Native {
  koffi: Any
  CGEventCreateKeyboardEvent: Any
  CGEventPost: Any
  CGEventSetFlags: Any
  AXIsProcessTrusted: Any
  CGWindowListCopyWindowInfo: Any
  CFArrayGetCount: Any
  CFArrayGetValueAtIndex: Any
  CFDictionaryGetValue: Any
  CFStringGetCString: Any
  CFNumberGetValue: Any
  CFBooleanGetValue: Any
  CFRelease: Any
  numberBuf: Any
  keys: Record<string, Any>
}

let cached: Native | null | undefined

export function loadMacNative(): Native | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    const koffi = requireNative('koffi')
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    const app = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
    const CFStringCreateWithCString = cf.func('void* CFStringCreateWithCString(void* alloc, const char* cStr, uint32 encoding)')
    const key = (name: string) => CFStringCreateWithCString(null, name, CF_STRING_ENCODING_UTF8)
    cached = {
      koffi,
      CGEventCreateKeyboardEvent: cg.func('void* CGEventCreateKeyboardEvent(void* source, uint16 virtualKey, bool keyDown)'),
      CGEventPost: cg.func('void CGEventPost(uint32 tap, void* event)'),
      CGEventSetFlags: cg.func('void CGEventSetFlags(void* event, uint64 flags)'),
      AXIsProcessTrusted: app.func('bool AXIsProcessTrusted()'),
      CGWindowListCopyWindowInfo: cg.func('void* CGWindowListCopyWindowInfo(uint32 option, uint32 relativeToWindow)'),
      CFArrayGetCount: cf.func('long CFArrayGetCount(void* theArray)'),
      CFArrayGetValueAtIndex: cf.func('void* CFArrayGetValueAtIndex(void* theArray, long idx)'),
      CFDictionaryGetValue: cf.func('void* CFDictionaryGetValue(void* dict, void* key)'),
      CFStringGetCString: cf.func('bool CFStringGetCString(void* string, void* buffer, long bufferSize, uint32 encoding)'),
      CFNumberGetValue: cf.func('bool CFNumberGetValue(void* number, int32 theType, void* valuePtr)'),
      CFBooleanGetValue: cf.func('bool CFBooleanGetValue(void* boolean)'),
      CFRelease: cf.func('void CFRelease(void* cf)'),
      numberBuf: koffi.alloc('double', 1),
      keys: {
        ownerName: key('kCGWindowOwnerName'),
        name: key('kCGWindowName'),
        ownerPid: key('kCGWindowOwnerPID'),
        layer: key('kCGWindowLayer'),
        bounds: key('kCGWindowBounds'),
        onscreen: key('kCGWindowIsOnscreen'),
        x: key('X'),
        y: key('Y'),
        width: key('Width'),
        height: key('Height'),
      },
    }
  } catch {
    cached = null
  }
  return cached
}

export function isTrusted(): boolean {
  const n = loadMacNative()
  if (!n) return false
  try {
    return Boolean(n.AXIsProcessTrusted())
  } catch {
    return false
  }
}

/**
 * Press one key, optionally with Command held.
 *
 * The flags are set explicitly on EVERY event, zero included: an event built with a null source
 * inherits the session's current modifier state, and the Command bit left over from a synthesized
 * Cmd+V does not clear itself. Without this the following Return arrives as Cmd+Return, which in
 * WeChat inserts a newline instead of sending — "the text pasted but nothing was sent".
 */
export function tap(keyCode: number, withCommand = false): void {
  const n = loadMacNative()
  if (!n) return
  for (const down of [true, false]) {
    const event = n.CGEventCreateKeyboardEvent(null, keyCode, down)
    if (!event) continue
    try {
      n.CGEventSetFlags(event, BigInt(withCommand ? FLAG_COMMAND : 0))
      n.CGEventPost(HID_EVENT_TAP, event)
    } finally {
      try { n.CFRelease(event) } catch { /* ignore */ }
    }
  }
}

export interface WeChatWindowState {
  found: boolean
  frontmost: boolean
}

interface WindowInfo {
  ownerPid: number
  ownerName: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  area: number
}

const readNumber = (n: Native, value: Any): number => {
  if (!value) return 0
  try {
    if (!n.CFNumberGetValue(value, CF_NUMBER_DOUBLE_TYPE, n.numberBuf)) return 0
    return Number(n.koffi.decode(n.numberBuf, 'double', 1)[0])
  } catch {
    return 0
  }
}

const readBoolean = (n: Native, value: Any): boolean => {
  if (!value) return false
  try {
    return Boolean(n.CFBooleanGetValue(value))
  } catch {
    return false
  }
}

const readString = (n: Native, value: Any): string => {
  if (!value) return ''
  const buffer = Buffer.alloc(512)
  try {
    if (!n.CFStringGetCString(value, buffer, buffer.length, CF_STRING_ENCODING_UTF8)) return ''
    const end = buffer.indexOf(0)
    return buffer.toString('utf8', 0, end === -1 ? buffer.length : end).trim()
  } catch {
    return ''
  }
}

function readWindow(n: Native, dict: Any): WindowInfo | null {
  const layer = readNumber(n, n.CFDictionaryGetValue(dict, n.keys.layer))
  const onscreen = readBoolean(n, n.CFDictionaryGetValue(dict, n.keys.onscreen))
  const boundsDict = n.CFDictionaryGetValue(dict, n.keys.bounds)
  if (layer !== NORMAL_WINDOW_LAYER || !onscreen || !boundsDict) return null
  const bounds = {
    x: readNumber(n, n.CFDictionaryGetValue(boundsDict, n.keys.x)),
    y: readNumber(n, n.CFDictionaryGetValue(boundsDict, n.keys.y)),
    width: readNumber(n, n.CFDictionaryGetValue(boundsDict, n.keys.width)),
    height: readNumber(n, n.CFDictionaryGetValue(boundsDict, n.keys.height)),
  }
  if (bounds.width <= 0 || bounds.height <= 0) return null
  return {
    ownerPid: Math.round(readNumber(n, n.CFDictionaryGetValue(dict, n.keys.ownerPid))),
    ownerName: readString(n, n.CFDictionaryGetValue(dict, n.keys.ownerName)),
    title: readString(n, n.CFDictionaryGetValue(dict, n.keys.name)),
    bounds,
    area: bounds.width * bounds.height,
  }
}

const isWeChat = (w: WindowInfo): boolean => w.ownerName === 'WeChat' || w.ownerName === '微信' || w.ownerName === 'Weixin'

const near = (a: WindowInfo['bounds'], b: WindowInfo['bounds']): boolean =>
  Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2

/**
 * CGWindowList returns on-screen windows front-to-back, so the first normal window that is not ours
 * is whatever the user is looking at. WeChat's image viewer is also a top-level WeChat window, so
 * the main window is picked by area with a bonus for the real title rather than by size alone.
 */
export function probeWeChatWindow(): WeChatWindowState {
  const n = loadMacNative()
  if (!n) return { found: false, frontmost: false }
  let list: Any = null
  try {
    list = n.CGWindowListCopyWindowInfo(WINDOW_LIST_OPTIONS, 0)
    if (!list) return { found: false, frontmost: false }
    const count = Number(n.CFArrayGetCount(list))
    let main: (WindowInfo & { score: number }) | null = null
    let front: WindowInfo | null = null
    for (let i = 0; i < count; i++) {
      const info = readWindow(n, n.CFArrayGetValueAtIndex(list, i))
      if (!info) continue
      if (!front && info.ownerPid !== process.pid) front = info
      if (!isWeChat(info)) continue
      const score = info.area + (info.title === '微信' || info.title === 'WeChat' ? 1_000_000_000 : 0)
      if (!main || score > main.score) main = { ...info, score }
    }
    if (!main) return { found: false, frontmost: false }
    return { found: true, frontmost: Boolean(front && front.ownerPid === main.ownerPid && near(main.bounds, front.bounds)) }
  } catch {
    return { found: false, frontmost: false }
  } finally {
    if (list) {
      try {
        n.CFRelease(list)
      } catch { /* ignore */ }
    }
  }
}
