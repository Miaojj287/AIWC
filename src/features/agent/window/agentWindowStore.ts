/**
 * Agent window session state (zustand): which list the sidebar shows, its search text, whether the user hid
 * the workspace pane, and the ⌘K focus request. Widths and the collapsed sidebar persist in AppConfig.ui
 * (src/shell/agentWindowLayout.ts); the layout itself (`ui.shellMode`) is switched by src/app/shellMode.ts.
 */
import { create } from 'zustand'

export type SidebarView = 'threads' | 'tasks'

export interface AgentWindowState {
  sidebarView: SidebarView
  /** Search text of the sidebar (threads or scheduled tasks, whichever is shown). */
  query: string
  /** The user hid the workspace pane; reset when a tab is (re)opened or the last tab closes. */
  paneHidden: boolean
  /** Monotonic counter: ⌘K bumps it, the sidebar focuses its search box. */
  searchFocusRequest: number

  setSidebarView(view: SidebarView): void
  setQuery(query: string): void
  setPaneHidden(hidden: boolean): void
  requestSearchFocus(): void
}

export const useAgentWindowStore = create<AgentWindowState>((set) => ({
  sidebarView: 'threads',
  query: '',
  paneHidden: false,
  searchFocusRequest: 0,

  setSidebarView(view) {
    set({ sidebarView: view })
  },
  setQuery(query) {
    set({ query })
  },
  setPaneHidden(hidden) {
    set({ paneHidden: hidden })
  },
  requestSearchFocus() {
    set((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 }))
  },
}))

/** Reset for tests. */
export function __resetAgentWindowStoreForTests(): void {
  useAgentWindowStore.setState({ sidebarView: 'threads', query: '', paneHidden: false, searchFocusRequest: 0 })
}
