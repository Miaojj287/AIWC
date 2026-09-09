/**
 * Reply-desk store (zustand around the pure reducer). Starts listening to 'autoreply:draft' and
 * 'gateway:event' as soon as the feature registers, so the shell can show the pending badge before
 * the tab is ever opened. `useReplyDeskCount` is the export the shell consumes.
 */
import { create } from 'zustand'
import type { ReplyDraft } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'
import { initialReplyDeskState, pendingCount, replyDeskReducer, type ReplyDeskAction, type ReplyDeskState } from './reducer'

interface ReplyDeskStore {
  state: ReplyDeskState
  dispatch: (action: ReplyDeskAction) => void
  /** Reload the pending drafts from the backend. */
  reload: () => Promise<void>
}

export const useReplyDeskStore = create<ReplyDeskStore>((set, get) => ({
  state: initialReplyDeskState,
  dispatch: (action) => set({ state: replyDeskReducer(get().state, action) }),
  reload: async () => {
    try {
      const bridge = await getBridge()
      const drafts = await bridge.invoke('autoreply:listDrafts', undefined)
      get().dispatch({ type: 'loaded', drafts })
      const status = await bridge.invoke('autoreply:status', undefined).catch(() => undefined)
      for (const item of status?.generating ?? []) get().dispatch({ type: 'generating', ...item, active: true })
      if (status) get().dispatch(status.halted ? { type: 'halted', reason: status.halted } : { type: 'resumed' })
    } catch (e) {
      get().dispatch({ type: 'load_failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))

let started: Promise<() => void> | undefined

/** Idempotent: subscribe to bridge pushes and load the current drafts. Returns the unsubscribe. */
export function startReplyDesk(): Promise<() => void> {
  if (started) return started
  started = getBridge().then((bridge) => {
    const { dispatch } = useReplyDeskStore.getState()
    const offDraft = bridge.on('autoreply:draft', (draft: ReplyDraft) => dispatch({ type: 'draft', draft }))
    const offGateway = bridge.on('gateway:event', (e) => {
      if (e.type === 'autoreply.generating') dispatch({ ...e, type: 'generating' })
      else if (e.type === 'autoreply.countdown') dispatch({ type: 'countdown', draftId: e.draftId, remainingMs: e.remainingMs })
      else if (e.type === 'autoreply.halted') dispatch({ type: 'halted', reason: e.reason })
    })
    void useReplyDeskStore.getState().reload()
    return () => {
      offDraft()
      offGateway()
      started = undefined
    }
  })
  return started
}

/** Drafts still waiting for a decision — the shell may show this as a badge. */
export function useReplyDeskCount(): number {
  return useReplyDeskStore((s) => pendingCount(s.state))
}

/** Reset for tests. */
export function __resetReplyDeskForTests(): void {
  started = undefined
  useReplyDeskStore.setState({ state: initialReplyDeskState })
}
