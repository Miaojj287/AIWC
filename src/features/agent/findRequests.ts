/**
 * ⌘F inside the Agent conversation (CLAUDE.md §4.8): the shortcut is claimed only while keyboard focus is in the
 * conversation (platform/focusScope.ts, scope `agent`); elsewhere it keeps its workspace meaning. A request bumps a
 * counter the mounted transcript (panel or window, never both) answers by opening its find bar.
 */
import { create } from 'zustand'
import { focusedFindScope } from '@/platform/focusScope'

export const AGENT_FIND_SCOPE = 'agent'

interface FindRequests {
  seq: number
  request(): void
}

export const useConversationFind = create<FindRequests>((set) => ({
  seq: 0,
  request: () => set((s) => ({ seq: s.seq + 1 })),
}))

/** The `search.inPage` handler: opens the conversation's find bar when focus is in the conversation. */
export function findInConversation(): void {
  if (focusedFindScope() === AGENT_FIND_SCOPE) useConversationFind.getState().request()
}
