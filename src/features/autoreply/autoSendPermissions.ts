/**
 * What auto send still needs from the OS, and where to fix it. The halt cause and the permission states are
 * structured codes from the main process (never matched against message text, AGENTS.md §2.5).
 */
import type { AutoSendHaltCode, AutoSendPermissions, OsPermissionState } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { invoke } from '@/platform/hooks'

export type OsPermission = 'accessibility' | 'automation'

/** macOS deep links (app:openUrl allows the x-apple.systempreferences scheme). */
export const SETTINGS_PANE: Record<OsPermission, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
}

const BLOCKING: ReadonlySet<OsPermissionState> = new Set(['denied', 'stale'])

/** Permissions that currently stop auto send, in the order to fix them. */
export function blockingPermissions(p: AutoSendPermissions | undefined): OsPermission[] {
  if (!p) return []
  return (['accessibility', 'automation'] as const).filter((key) => BLOCKING.has(p[key]))
}

/** The settings pane that fixes a halt, when the halt is a permission problem. */
export function paneForHalt(code: AutoSendHaltCode | undefined): OsPermission | undefined {
  if (code === 'no-permission') return 'accessibility'
  if (code === 'automation-denied') return 'automation'
  return undefined
}

export function openPermissionPane(permission: OsPermission): void {
  void invoke('app:openUrl', { url: SETTINGS_PANE[permission] }).catch(() =>
    toast.error(t('autoreply.control.openSettingsFailed')),
  )
}

/**
 * After a rule is switched on: if the OS would stop the reply from being typed, say so right away (with the pane
 * to fix it) instead of letting the first incoming message halt the sender.
 */
export async function warnIfAutoSendBlocked(): Promise<void> {
  let permissions: AutoSendPermissions
  try {
    permissions = await invoke('privacy:autoSendPermissions', undefined)
  } catch {
    // The check is advisory: the rule is already on and the sender still verifies every send.
    return
  }
  const first = blockingPermissions(permissions)[0]
  if (permissions.platform === 'linux') {
    toast.warning(t('autoreply.permissions.unsupported'))
    return
  }
  if (!first) return
  toast.warning(t('autoreply.permissions.blockedToast'), {
    action: { label: t('autoreply.permissions.blockedAction'), onClick: () => openPermissionPane(first) },
  })
}
