/**
 * Window layout switch (CLAUDE.md §12): `shell.setMode` / `shell.toggleMode` persist `ui.shellMode`, and App
 * renders the four-column Shell or the AgentWindow from it. Entered from the panel's 「Agent 窗口」 pill, the
 * window's 「工作台」 pill, ⌘⇧L, the View menu and 设置 › 常规 › 布局 — all through these two commands.
 */
import type { ShellMode } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'
import { onCommand } from './commands'

export const nextShellMode = (current: ShellMode | undefined): ShellMode =>
  current === 'agent' ? 'workbench' : 'agent'

export function currentShellMode(): ShellMode {
  return useConfigStore.getState().config?.ui.shellMode ?? 'workbench'
}

/** Persist the layout; a failed save rolls back inside configStore and is reported as a toast. */
export async function setShellMode(mode: ShellMode): Promise<void> {
  if (currentShellMode() === mode) return
  try {
    await useConfigStore.getState().set({ ui: { shellMode: mode } })
  } catch (e) {
    toast.error(t('app.layout.switchFailed'), { detail: e instanceof Error ? e.message : String(e) })
  }
}

export function installShellModeCommands(): () => void {
  const offs = [
    onCommand('shell.setMode', ({ mode }) => void setShellMode(mode)),
    onCommand('shell.toggleMode', () => void setShellMode(nextShellMode(currentShellMode()))),
  ]
  return () => offs.forEach((off) => off())
}
