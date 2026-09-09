/**
 * Chat feature — the 聊天预览 workspace Tab (kind 'chat', objectId = session id).
 * `register()` is called once from the app bootstrap: it registers the Tab renderer and the commands
 * other features / the shell dispatch (`tab.openChat`, `search.inPage`).
 */
import { onCommand } from '@/app/commands'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { ChatTab } from './ChatTab'
import { useChatUiStore } from './chatStore'

export function register(): void {
  registerTab({ kind: 'chat', icon: 'message-square', component: ChatTab })

  // `tab.openChat` itself is wired by the shell (src/app/tabCommands.ts): it opens / activates the tab and
  // merges `focusMessageId` into tab.state, which ChatTab consumes and turns into a scroll-to-anchor.

  // ⌘F: only when the active workspace tab is a chat preview (settings / other tabs handle their own).
  onCommand('search.inPage', () => {
    const { tabs, activeId } = useTabsStore.getState()
    const active = tabs.find((t) => t.id === activeId)
    if (active?.kind === 'chat') useChatUiStore.getState().openSearch(active.id)
  })
}

export { ChatTab } from './ChatTab'
export { useChatUiStore } from './chatStore'
export { DEFAULT_FILTERS, parseFilters, resolveRange, computeExportRange, type ChatFilters, type DateRange, type ExportRange } from './filters'
