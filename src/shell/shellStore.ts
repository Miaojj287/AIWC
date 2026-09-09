/**
 * Shell state (zustand): which rail function is selected, the ObjectList header's search / segment /
 * extra filters, and the Agent-panel unread marker shown on the collapsed strip.
 *
 * Column widths and collapsed flags are NOT here — they persist in AppConfig.ui via configStore.
 * Rule (DESIGN-SPEC §0.2): switching the rail only swaps the left column and activates that
 * function's last-active tab; it never closes tabs.
 */
import { create } from 'zustand'
import { useTabsStore, type RailFunction } from '@/workspace/tabsStore'

export type { RailFunction }

export interface ShellState {
  railFunction: RailFunction
  /** Text in the ObjectList header search box (per current function; reset on rail switch). */
  listQuery: string
  /** Selected segment id from ObjectListRegistration.segments; null = first segment. */
  listSegment: string | null
  /** Extra toggled filters offered by the list body (仅未读 / 已静音 …). */
  listFilters: Record<string, boolean>
  /** New Agent output arrived while the panel was collapsed. */
  agentUnread: boolean
  /** Monotonic counter: ⌘K (search.sessions) bumps it, the ObjectList focuses its search box. */
  searchFocusRequest: number

  /** Select a rail function: swap the list, activate that function's last tab (or none). */
  setRail(fn: RailFunction): void
  setListQuery(query: string): void
  setListSegment(id: string | null): void
  setListFilter(id: string, on: boolean): void
  clearListFilters(): void
  setAgentUnread(unread: boolean): void
  requestSearchFocus(): void
}

export const useShellStore = create<ShellState>((set, get) => ({
  railFunction: 'chat',
  listQuery: '',
  listSegment: null,
  listFilters: {},
  agentUnread: false,
  searchFocusRequest: 0,

  setRail(fn) {
    const changed = get().railFunction !== fn
    set({ railFunction: fn, ...(changed ? { listQuery: '', listSegment: null, listFilters: {} } : {}) })
    const tabs = useTabsStore.getState()
    const last = tabs.lastActiveFor(fn)
    if (last) tabs.activate(last.id)
    else if (changed) useTabsStore.setState({ activeId: null })
  },
  setListQuery(query) {
    set({ listQuery: query })
  },
  setListSegment(id) {
    set({ listSegment: id })
  },
  setListFilter(id, on) {
    set((s) => {
      const next = { ...s.listFilters }
      if (on) next[id] = true
      else delete next[id]
      return { listFilters: next }
    })
  },
  clearListFilters() {
    set({ listFilters: {}, listSegment: null })
  },
  setAgentUnread(unread) {
    if (get().agentUnread !== unread) set({ agentUnread: unread })
  },
  requestSearchFocus() {
    set((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 }))
  },
}))

/** True when any header filter deviates from the default (segment or extra filters). */
export const hasActiveListFilters = (s: Pick<ShellState, 'listSegment' | 'listFilters'>, firstSegmentId?: string): boolean =>
  Object.keys(s.listFilters).length > 0 || (s.listSegment !== null && s.listSegment !== firstSegmentId)

/** Reset for tests. */
export function __resetShellStoreForTests(): void {
  useShellStore.setState({ railFunction: 'chat', listQuery: '', listSegment: null, listFilters: {}, agentUnread: false, searchFocusRequest: 0 })
}
