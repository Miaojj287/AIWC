/**
 * Ephemeral per-tab UI state for chat tabs (zustand): the ⌘F search bar and pending "focus this
 * message" requests coming from `tab.openChat` / search hits. Persistent per-tab state (filters) lives
 * in TabDescriptor.state instead.
 */
import { create } from 'zustand'

export interface ChatTabUi {
  searchOpen: boolean
  /** Message the tab should scroll to once its stream is ready. */
  focusMessageId?: string
  /** Bumped on every request so the same id can be focused twice. */
  focusNonce: number
}

interface ChatUiState {
  byTab: Record<string, ChatTabUi>
  openSearch(tabId: string): void
  closeSearch(tabId: string): void
  requestFocus(tabId: string, messageId: string): void
  clearFocus(tabId: string): void
  forget(tabId: string): void
}

const EMPTY: ChatTabUi = { searchOpen: false, focusNonce: 0 }

export const useChatUiStore = create<ChatUiState>((set) => ({
  byTab: {},
  openSearch(tabId) {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? EMPTY), searchOpen: true } } }))
  },
  closeSearch(tabId) {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? EMPTY), searchOpen: false } } }))
  },
  requestFocus(tabId, messageId) {
    set((s) => {
      const prev = s.byTab[tabId] ?? EMPTY
      return { byTab: { ...s.byTab, [tabId]: { ...prev, focusMessageId: messageId, focusNonce: prev.focusNonce + 1 } } }
    })
  },
  clearFocus(tabId) {
    set((s) => {
      const prev = s.byTab[tabId]
      if (!prev || prev.focusMessageId === undefined) return {}
      return { byTab: { ...s.byTab, [tabId]: { ...prev, focusMessageId: undefined } } }
    })
  },
  forget(tabId) {
    set((s) => {
      if (!(tabId in s.byTab)) return {}
      const next = { ...s.byTab }
      delete next[tabId]
      return { byTab: next }
    })
  },
}))

export const selectChatUi = (tabId: string) => (s: ChatUiState): ChatTabUi => s.byTab[tabId] ?? EMPTY

/** Reset for tests. */
export function __resetChatUiStoreForTests(): void {
  useChatUiStore.setState({ byTab: {} })
}
