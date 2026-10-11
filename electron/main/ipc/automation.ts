/**
 * automation:* — the dock / taskbar badge for Agent threads that finished unseen or failed. The renderer owns the
 * count (only it knows which thread is on screen); this handler validates it and hands it to the OS. macOS shows it
 * on the dock icon and Linux (Unity) on the launcher; Windows has no numeric badge API, so there it is a no-op.
 */
import { app } from 'electron'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

/** Larger counts are shown as this (the dock truncates long numbers anyway). */
export const MAX_BADGE_COUNT = 99

/** A finite, non-negative integer count, capped; anything else is refused. */
export function badgeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error(t('main.automation.invalidBadge'))
  return Math.min(value, MAX_BADGE_COUNT)
}

export function registerAutomationIpc(_ctx: AppContext, _host: HostBridge, handle: Handle): void {
  handle('automation:setBadge', (req) => {
    const count = badgeCount(req?.count)
    if (process.platform === 'win32') return
    app.setBadgeCount(count)
  })
}
