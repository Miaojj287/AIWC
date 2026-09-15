/**
 * Settings feature — registers the single-instance 设置 Tab and the `tab.openSettings` command
 * (CLAUDE.md §1: settings is a workspace Tab, opened from the rail avatar / ⌘,).
 */
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { SETTINGS_TAB, isSettingsPage, type SettingsTabState } from './model'
import { SettingsTab } from './SettingsTab'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'settings', icon: 'settings', component: SettingsTab, title: () => t('settings.nav.tabTitle') })
  onCommand('tab.openSettings', (payload) => openSettings(payload ?? {}))
}

/** Open (or focus) the settings tab, optionally jumping to a page and highlighting a row. */
export function openSettings({ page, highlight }: { page?: string; highlight?: string } = {}): string {
  const tabs = useTabsStore.getState()
  const existing = tabs.tabs.find((t) => t.kind === SETTINGS_TAB.kind && t.objectId === SETTINGS_TAB.objectId)
  const nextState: SettingsTabState = {
    page: isSettingsPage(page) ? page : ((existing?.state as SettingsTabState | undefined)?.page ?? 'general'),
    highlight,
  }
  const id = tabs.open({ ...SETTINGS_TAB, state: { ...(existing?.state ?? {}), ...nextState } })
  if (existing) tabs.update(id, { state: { ...(existing.state ?? {}), ...nextState } })
  return id
}
