/**
 * Command → tab wiring (DESIGN-SPEC §0.2–0.3). Features dispatch `tab.open*`; this module builds the
 * TabDescriptor, switches the rail to the tab's function when needed, opens (or re-activates) the tab
 * and merges per-tab state (settings page, focused message…). Installed once by the Workspace.
 */
import { onCommand, runCommand, type CommandMap } from '@/app/commands'
import { toast } from '@/kit'
import { useShellStore } from '@/shell/shellStore'
import type { TabDescriptor, TabKind } from '@/workspace/tabRegistry'
import { TAB_FUNCTION, useTabsStore } from '@/workspace/tabsStore'

export interface TabCommandDeps {
  /** Close with the dirty guard (Workspace owns the dialog). */
  requestClose(id: string): void
}

export const SETTINGS_TAB_ID = 'settings:settings'

type OpenRequest = Omit<TabDescriptor, 'id' | 'state'> & { state?: Record<string, unknown> }

/** Prefix a tab title once (「自动回复 · 产品市场群」), never twice. */
export function prefixedTitle(prefix: string, title: string): string {
  const t = title.trim()
  const p = `${prefix} · `
  return t.startsWith(p) ? t : `${p}${t}`
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Build the descriptor for a tab.open* command (pure — used by tests and the installer). */
export function descriptorFor<K extends keyof TabCommandPayloads>(command: K, payload: TabCommandPayloads[K] | undefined): OpenRequest | undefined {
  switch (command) {
    case 'tab.openChat': {
      const p = payload as CommandMap['tab.openChat'] | undefined
      if (!p?.sessionId) return undefined
      return { kind: 'chat', objectId: p.sessionId, title: p.title || p.sessionId, state: p.focusMessageId ? { focusMessageId: p.focusMessageId } : undefined }
    }
    case 'tab.openAutoReply': {
      const p = payload as CommandMap['tab.openAutoReply'] | undefined
      if (!p?.sessionId) return undefined
      return { kind: 'autoreply', objectId: p.sessionId, title: prefixedTitle('自动回复', p.title || p.sessionId) }
    }
    case 'tab.openClone': {
      const p = payload as CommandMap['tab.openClone'] | undefined
      if (!p?.contactId) return undefined
      return { kind: 'clone', objectId: p.contactId, title: prefixedTitle('克隆', p.title || p.contactId) }
    }
    case 'tab.openFile': {
      const p = payload as CommandMap['tab.openFile'] | undefined
      if (!p?.path) return undefined
      return { kind: 'file', objectId: p.path, title: p.title || fileName(p.path) }
    }
    case 'tab.openDiary': {
      const p = payload as CommandMap['tab.openDiary'] | undefined
      return { kind: 'diary', objectId: 'diary', title: '日记', state: p?.date ? { date: p.date } : undefined }
    }
    case 'tab.openReplyDesk':
      return { kind: 'replydesk', objectId: 'replydesk', title: '回复台' }
    case 'tab.openSettings': {
      const p = payload as CommandMap['tab.openSettings'] | undefined
      const state: Record<string, unknown> = {}
      if (p?.page) state.page = p.page
      if (p?.highlight) state.highlight = p.highlight
      return { kind: 'settings', objectId: 'settings', title: '设置', state: Object.keys(state).length ? state : undefined }
    }
    case 'tab.openKit':
      return { kind: 'kit', objectId: 'gallery', title: '组件库' }
    default:
      return undefined
  }
}

type TabCommandPayloads = Pick<CommandMap, 'tab.openChat' | 'tab.openAutoReply' | 'tab.openClone' | 'tab.openFile' | 'tab.openDiary' | 'tab.openReplyDesk' | 'tab.openSettings' | 'tab.openKit'>
const OPEN_COMMANDS = ['tab.openChat', 'tab.openAutoReply', 'tab.openClone', 'tab.openFile', 'tab.openDiary', 'tab.openReplyDesk', 'tab.openSettings', 'tab.openKit'] as const

/** Open or re-activate; switch the rail to the tab's function; merge defined state keys. */
export function openTab(req: OpenRequest): string {
  const fn = TAB_FUNCTION[req.kind]
  const shell = useShellStore.getState()
  if (fn && shell.railFunction !== fn) shell.setRail(fn)
  const tabs = useTabsStore.getState()
  const { state, ...rest } = req
  const id = tabs.open(rest)
  if (state && Object.keys(state).length > 0) {
    const existing = tabs.tabs.find((t) => t.id === id)
    tabs.update(id, { state: { ...(existing?.state ?? {}), ...state } })
  }
  return id
}

/** Object behind a tab, as an Agent @ reference (⌘⇧A). */
export function quoteRefFor(tab: TabDescriptor): CommandMap['agent.quote'] | undefined {
  switch (tab.kind) {
    case 'chat':
    case 'autoreply':
      return { kind: 'session', id: tab.objectId, label: tab.title.replace(/^自动回复 · /, '') }
    case 'clone':
      return { kind: 'contact', id: tab.objectId, label: tab.title.replace(/^克隆 · /, '') }
    case 'file':
      return { kind: 'file', id: tab.objectId, label: tab.title }
    default:
      return undefined
  }
}

export function installTabCommands(deps: TabCommandDeps): () => void {
  const offs: Array<() => void> = []
  for (const name of OPEN_COMMANDS) {
    offs.push(
      onCommand(name, (payload: unknown) => {
        const req = descriptorFor(name, payload as never)
        if (req) openTab(req)
      }),
    )
  }
  offs.push(
    onCommand('tab.closeActive', () => {
      const id = useTabsStore.getState().activeId
      if (id) deps.requestClose(id)
    }),
    onCommand('tab.reopenClosed', () => useTabsStore.getState().reopenLastClosed()),
    onCommand('rail.select', (payload) => {
      if (payload?.fn) useShellStore.getState().setRail(payload.fn)
    }),
    onCommand('agent.quoteActiveTab', () => {
      const { tabs, activeId } = useTabsStore.getState()
      const tab = tabs.find((t) => t.id === activeId)
      const ref = tab ? quoteRefFor(tab) : undefined
      if (!ref) {
        toast.info('当前标签没有可引用到 Agent 的对象', { detail: '打开一个会话、联系人或文件后再试' })
        return
      }
      runCommand('agent.quote', ref)
    }),
  )
  return () => offs.forEach((off) => off())
}

export const isTabKind = (v: unknown): v is TabKind => typeof v === 'string' && v in TAB_FUNCTION
