/**
 * Workspace tab state (zustand). Pages open tabs through this store; the container renders them.
 * Rules: DESIGN-SPEC §0.3 — one tab per object, pinned tabs first, dirty guard on close,
 * "recently closed" for ⌘⇧T, per-function last-active tab memory (§0.2).
 */
import { create } from 'zustand'
import type { TabDescriptor, TabKind } from './tabRegistry'
import { tabId } from './tabRegistry'

export type RailFunction = 'chat' | 'autoreply' | 'clone'

/** Which rail function a tab kind belongs to (for §0.2 "activate that function's last tab"). */
export const TAB_FUNCTION: Record<TabKind, RailFunction | null> = {
  chat: 'chat',
  autoreply: 'autoreply',
  clone: 'clone',
  settings: null,
  file: null,
  diary: null,
  replydesk: null,
  kit: null,
}

interface TabsState {
  tabs: TabDescriptor[]
  activeId: string | null
  recentlyClosed: TabDescriptor[]
  lastActiveByFunction: Partial<Record<RailFunction, string>>

  /** Open (or activate if exists) and return the tab id. */
  open(desc: Omit<TabDescriptor, 'id'> & { id?: string }): string
  activate(id: string): void
  /** Close without dirty-guard. Callers use requestClose() from the container for the guard. */
  close(id: string): void
  closeOthers(id: string): void
  closeToRight(id: string): void
  reopenLastClosed(): void
  pin(id: string, pinned: boolean): void
  move(fromIndex: number, toIndex: number): void
  update(id: string, patch: Partial<Pick<TabDescriptor, 'title' | 'dirty' | 'state'>>): void
  lastActiveFor(fn: RailFunction): TabDescriptor | undefined
}

const sortPinnedFirst = (tabs: TabDescriptor[]) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  recentlyClosed: [],
  lastActiveByFunction: {},

  open(desc) {
    const id = desc.id ?? tabId(desc.kind, desc.objectId)
    const existing = get().tabs.find((t) => t.id === id)
    if (existing) {
      get().activate(id)
      return id
    }
    const tab: TabDescriptor = { ...desc, id }
    set((s) => ({ tabs: sortPinnedFirst([...s.tabs, tab]) }))
    get().activate(id)
    return id
  },

  activate(id) {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    const fn = TAB_FUNCTION[tab.kind]
    set((s) => ({
      activeId: id,
      lastActiveByFunction: fn ? { ...s.lastActiveByFunction, [fn]: id } : s.lastActiveByFunction,
    }))
  },

  close(id) {
    const { tabs, activeId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const closed = tabs[idx]!
    const next = tabs.filter((t) => t.id !== id)
    let nextActive = activeId
    if (activeId === id) {
      const neighbour = next[Math.min(idx, next.length - 1)]
      nextActive = neighbour?.id ?? null
    }
    set((s) => ({
      tabs: next,
      activeId: nextActive,
      recentlyClosed: [closed, ...s.recentlyClosed].slice(0, 20),
      lastActiveByFunction: Object.fromEntries(
        Object.entries(s.lastActiveByFunction).filter(([, v]) => v !== id),
      ) as Partial<Record<RailFunction, string>>,
    }))
    if (nextActive) get().activate(nextActive)
  },

  closeOthers(id) {
    for (const t of get().tabs) if (t.id !== id && !t.pinned) get().close(t.id)
  },

  closeToRight(id) {
    const { tabs } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    for (const t of tabs.slice(idx + 1)) if (!t.pinned) get().close(t.id)
  },

  reopenLastClosed() {
    const [last, ...rest] = get().recentlyClosed
    if (!last) return
    set({ recentlyClosed: rest })
    get().open(last)
  },

  pin(id, pinned) {
    set((s) => ({ tabs: sortPinnedFirst(s.tabs.map((t) => (t.id === id ? { ...t, pinned } : t))) }))
  },

  move(fromIndex, toIndex) {
    set((s) => {
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(fromIndex, 1)
      if (!moved) return {}
      tabs.splice(toIndex, 0, moved)
      return { tabs: sortPinnedFirst(tabs) }
    })
  },

  update(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  },

  lastActiveFor(fn) {
    const id = get().lastActiveByFunction[fn]
    return id ? get().tabs.find((t) => t.id === id) : undefined
  },
}))
