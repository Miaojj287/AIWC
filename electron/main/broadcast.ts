/**
 * main → renderer push helpers. Every EventMap channel goes through `broadcast`, which writes to all
 * live BrowserWindows (there is normally one, but 设置 / 向导 may add more later).
 */
import { BrowserWindow } from 'electron'
import type { EventChannel, EventMap } from '@aiwc/protocol'
import type { Broadcast } from './contracts'

export function createBroadcast(): Broadcast {
  return <K extends EventChannel>(channel: K, payload: EventMap[K]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch {
        // window closing mid-send; nothing to do
      }
    }
  }
}

/** Send to the focused window (fallback: first live window). Used by menu commands. */
export function sendToActive<K extends EventChannel>(channel: K, payload: EventMap[K]): boolean {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!target || target.isDestroyed()) return false
  target.webContents.send(channel, payload)
  return true
}
