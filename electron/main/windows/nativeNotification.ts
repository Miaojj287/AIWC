/**
 * The Electron side of services/systemNotifier.ts: the OS notification and how the app reports focus. Kept apart so
 * the notifier's policy stays testable without Electron.
 */
import { BrowserWindow, Notification } from 'electron'
import type { NativeNotification, ShowRequest } from '../services/systemNotifier'

export const notificationsSupported = (): boolean => Notification.isSupported()

/** Any AIWC window has focus (then the in-app toast is what the user sees). */
export const isAppFocused = (): boolean => BrowserWindow.getFocusedWindow() !== null

export function showNativeNotification(request: ShowRequest, icon?: string): NativeNotification {
  const notification = new Notification({ title: request.title, body: request.body ?? '', icon })
  notification.on('click', request.onClick)
  notification.on('close', request.onClose)
  notification.show()
  return notification
}
