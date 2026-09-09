/**
 * Workspace tab ↔ Agent context reference. A new thread references the object behind the active
 * workspace tab (DESIGN-SPEC §1.3 多会话); the reference becomes the first @ chip of the composer.
 */
import type { Mention, ThreadSummary } from '@aiwc/protocol'
import type { TabDescriptor } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'

export type ContextRef = NonNullable<ThreadSummary['contextRef']>

export function contextRefFromTab(tab: TabDescriptor | undefined | null): ContextRef | undefined {
  if (!tab) return undefined
  switch (tab.kind) {
    case 'chat':
    case 'autoreply':
      return { kind: 'session', id: tab.objectId, label: tab.title.replace(/^自动回复\s*·\s*/, '') }
    case 'file':
      return { kind: 'file', id: tab.objectId, label: tab.title }
    case 'clone':
      return { kind: 'contact', id: tab.objectId, label: tab.title }
    default:
      return undefined
  }
}

/** Context reference of the workspace tab that is active right now (undefined for settings / none). */
export function activeTabContextRef(): ContextRef | undefined {
  const { tabs, activeId } = useTabsStore.getState()
  return contextRefFromTab(tabs.find((t) => t.id === activeId))
}

export const mentionFromContextRef = (ref: ContextRef): Mention => ({ kind: ref.kind, id: ref.id, label: ref.label })

/** Open workspace file tabs — the source of the 文件 mention category. */
export function openFileTabs(): TabDescriptor[] {
  return useTabsStore.getState().tabs.filter((t) => t.kind === 'file')
}
