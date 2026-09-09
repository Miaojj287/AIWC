/**
 * Workspace Tab contract. Feature packages register a TabRenderer per tab kind; the Tab container
 * (src/workspace/Workspace.tsx) only knows this interface. Keep this file dependency-free.
 */
import type { ComponentType } from 'react'

export type TabKind = 'chat' | 'autoreply' | 'clone' | 'settings' | 'file' | 'diary' | 'replydesk' | 'kit'

export interface TabDescriptor {
  /** stable identity: `${kind}:${objectId}` — the container de-duplicates on this */
  id: string
  kind: TabKind
  /** object the tab is about: session id / contact id / file path / settings page */
  objectId: string
  title: string
  pinned?: boolean
  dirty?: boolean
  /** optional per-tab state the renderer wants restored (scroll, filters) */
  state?: Record<string, unknown>
}

export interface TabRendererProps {
  tab: TabDescriptor
  active: boolean
  /** Update title / dirty / state for this tab. */
  update(patch: Partial<Pick<TabDescriptor, 'title' | 'dirty' | 'state'>>): void
  /** Ask the container to close this tab (runs the dirty-guard). */
  requestClose(): void
}

export interface TabRegistration {
  kind: TabKind
  /** lucide icon name, rendered by the tab strip */
  icon: string
  component: ComponentType<TabRendererProps>
  /** Called before close when tab.dirty; return false to cancel. Default: confirm dialog. */
  canClose?: (tab: TabDescriptor) => Promise<boolean>
}

const registry = new Map<TabKind, TabRegistration>()

export function registerTab(reg: TabRegistration): void {
  registry.set(reg.kind, reg)
}

export function getTabRegistration(kind: TabKind): TabRegistration | undefined {
  return registry.get(kind)
}

export function tabId(kind: TabKind, objectId: string): string {
  return `${kind}:${objectId}`
}
