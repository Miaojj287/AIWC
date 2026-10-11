/**
 * The keyboard shortcut sheet's content (⌘/ · Help › Keyboard Shortcuts). The global rows come from the one shortcut
 * registry (SHORTCUTS), so a new binding shows up here once it has a label below — shortcutSheet.test.ts fails while
 * one is missing. The Agent composer's keys follow 设置 › 常规 › 发送消息. Labels are platform-correct
 * (⇧⌘T on macOS, Ctrl+Shift+T on Windows — CLAUDE.md §13). Pure.
 */
import type { ComposerSendKey } from '@aiwc/protocol'
import type { MessageKey } from '@/i18n'
import type { CommandName } from './commands'
import { formatShortcut, SHORTCUTS, type ShortcutBinding } from './shortcuts'

export type SheetGroupId = 'features' | 'navigation' | 'layout' | 'agent' | 'composer' | 'help'

export interface SheetRow {
  id: string
  label: MessageKey
  keys: string
}

export interface SheetGroup {
  id: SheetGroupId
  rows: SheetRow[]
}

/** Row id of a binding: the command, plus the rail function for ⌘1–5. */
export const bindingId = (b: Pick<ShortcutBinding, 'command' | 'payload'>): string => {
  const fn = (b.payload as { fn?: string } | undefined)?.fn
  return fn ? `${b.command}:${fn}` : b.command
}

/** Label and group of every global binding (by bindingId). */
export const SHORTCUT_ROWS: Record<string, { label: MessageKey; group: SheetGroupId }> = {
  'rail.select:chat': { label: 'app.shortcuts.rows.railChat', group: 'features' },
  'rail.select:autoreply': { label: 'app.shortcuts.rows.railAutoreply', group: 'features' },
  'rail.select:clone': { label: 'app.shortcuts.rows.railClone', group: 'features' },
  'rail.select:tasks': { label: 'app.shortcuts.rows.railTasks', group: 'features' },
  'rail.select:todo': { label: 'app.shortcuts.rows.railTodo', group: 'features' },
  'tab.openSettings': { label: 'app.shortcuts.rows.openSettings', group: 'navigation' },
  'search.sessions': { label: 'app.shortcuts.rows.searchSessions', group: 'navigation' },
  'search.inPage': { label: 'app.shortcuts.rows.searchInPage', group: 'navigation' },
  'tab.openSearch': { label: 'app.shortcuts.rows.openSearch', group: 'navigation' },
  'tab.closeActive': { label: 'app.shortcuts.rows.closeTab', group: 'layout' },
  'tab.reopenClosed': { label: 'app.shortcuts.rows.reopenTab', group: 'layout' },
  'objectList.toggleCollapsed': { label: 'app.shortcuts.rows.toggleObjectList', group: 'layout' },
  'agent.toggleCollapsed': { label: 'app.shortcuts.rows.toggleAgent', group: 'layout' },
  'shell.toggleMode': { label: 'app.shortcuts.rows.toggleShellMode', group: 'layout' },
  'agent.newThread': { label: 'app.shortcuts.rows.newThread', group: 'agent' },
  'agent.quoteActiveTab': { label: 'app.shortcuts.rows.quoteActiveTab', group: 'agent' },
  'tab.openKit': { label: 'app.shortcuts.rows.openKit', group: 'help' },
  'app.showShortcuts': { label: 'app.shortcuts.rows.showShortcuts', group: 'help' },
} satisfies Record<string, { label: MessageKey; group: SheetGroupId }>

const GROUP_ORDER: readonly SheetGroupId[] = ['features', 'navigation', 'layout', 'agent', 'composer', 'help']

/** The composer's own keys (they act inside the input box, not through the command bus). */
function composerRows(sendKey: ComposerSendKey, mac: boolean): SheetRow[] {
  const enter = (mod: boolean, extra: Partial<Pick<ShortcutBinding, 'shift' | 'alt'>> = {}) =>
    formatShortcut({ key: 'Enter', mod, ...extra }, mac)
  return [
    { id: 'composer.send', label: 'app.shortcuts.rows.send', keys: enter(sendKey === 'modEnter') },
    { id: 'composer.newline', label: 'app.shortcuts.rows.newline', keys: enter(false, { shift: sendKey === 'enter' }) },
    { id: 'composer.queue', label: 'app.shortcuts.rows.queue', keys: enter(false, { alt: true }) },
    { id: 'composer.stop', label: 'app.shortcuts.rows.stop', keys: 'Esc' },
    { id: 'composer.history', label: 'app.shortcuts.rows.history', keys: '↑ ↓' },
    { id: 'composer.mention', label: 'app.shortcuts.rows.mention', keys: '@' },
    { id: 'composer.skill', label: 'app.shortcuts.rows.skill', keys: '/' },
  ]
}

export function shortcutSheet(env: { mac: boolean; web: boolean; sendKey: ComposerSendKey }): SheetGroup[] {
  const groups = new Map<SheetGroupId, SheetRow[]>(GROUP_ORDER.map((id) => [id, []]))
  for (const binding of SHORTCUTS) {
    if (binding.webOnly && !env.web) continue
    const id = bindingId(binding)
    const meta = SHORTCUT_ROWS[id]
    if (!meta) continue
    groups.get(meta.group)?.push({ id, label: meta.label, keys: formatShortcut(binding, env.mac) })
  }
  groups.get('composer')?.push(...composerRows(env.sendKey, env.mac))
  return GROUP_ORDER.map((id) => ({ id, rows: groups.get(id) ?? [] })).filter((g) => g.rows.length > 0)
}

/** Commands bound in SHORTCUTS that the sheet has no label for (the test keeps this empty). */
export const unlabelledShortcuts = (): CommandName[] =>
  SHORTCUTS.filter((b) => !SHORTCUT_ROWS[bindingId(b)]).map((b) => b.command)
