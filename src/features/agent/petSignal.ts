/**
 * Agent → pet signal. The pet reflects the active thread: working, waiting for 二次确认, and how the
 * latest turn ended. "Just finished" is recorded from live streaming → idle transitions (a store
 * subscription), so opening an old thread never replays a stale 完成了.
 */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { AgentPetSignal, PetReaction } from '@/features/pets'
import { t, type MessageKey } from '@/i18n'
import { useAgentStore } from './agentStore'
import type { ThreadItem, ThreadViewState } from './model'

export interface TurnOutcome {
  turnId?: string
  outcome: 'completed' | 'failed' | 'interrupted'
  message?: string
}

/** Same wording as the aborted notice in the message list. */
const ABORT_MESSAGE: Record<string, MessageKey> = {
  step_cap: 'agent.turn.aborted.stepCap',
  loop_guard: 'agent.turn.aborted.loopGuard',
  timeout: 'agent.turn.aborted.timeout',
  error: 'agent.turn.aborted.error',
}

/** How the latest turn (everything after the last user message) ended. */
export function turnOutcome(items: readonly ThreadItem[]): TurnOutcome | undefined {
  if (items.length === 0) return undefined
  let start = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.kind === 'user') {
      start = i
      break
    }
  }
  const userItem = start >= 0 ? items[start] : undefined
  const turnId = userItem?.kind === 'user' ? userItem.turnId : undefined
  const tail = items.slice(start + 1)
  for (let i = tail.length - 1; i >= 0; i--) {
    const it = tail[i]!
    if (it.kind === 'error') return { turnId, outcome: 'failed', message: it.error.message }
    if (it.kind === 'aborted') {
      if (it.reason === 'interrupted' || it.reason === 'replaced') return { turnId, outcome: 'interrupted' }
      const key = ABORT_MESSAGE[it.reason]
      return { turnId, outcome: 'failed', message: key ? t(key) : undefined }
    }
  }
  for (let i = tail.length - 1; i >= 0; i--) {
    const it = tail[i]!
    if (it.kind === 'assistant' && it.text.trim()) return { turnId, outcome: 'completed', message: it.text }
  }
  return { turnId, outcome: 'completed' }
}

/** Summary of the tool call running right now in the current turn. */
export function runningActivity(view: ThreadViewState | undefined): string | undefined {
  if (!view?.isStreaming) return undefined
  for (let i = view.items.length - 1; i >= 0; i--) {
    const it = view.items[i]!
    if (it.kind === 'user') return undefined
    if (it.kind !== 'tools') continue
    const running = [...it.calls].reverse().find((c) => c.status === 'running')
    if (running) return running.summary
  }
  return undefined
}

interface PetReactionState {
  reactions: Record<string, PetReaction>
}

export const usePetReactionStore = create<PetReactionState>(() => ({ reactions: {} }))

let unwatch: (() => void) | undefined

/** Record a reaction whenever any thread stops streaming. Idempotent; called at feature registration. */
export function watchPetReactions(clock: () => number = () => Date.now()): void {
  if (unwatch) return
  unwatch = useAgentStore.subscribe((state, prev) => {
    if (state.views === prev.views) return
    let next: Record<string, PetReaction> | undefined
    for (const [threadId, view] of Object.entries(state.views)) {
      if (view.isStreaming || !prev.views[threadId]?.isStreaming) continue
      const result = turnOutcome(view.items)
      next ??= { ...usePetReactionStore.getState().reactions }
      if (!result || result.outcome === 'interrupted') {
        delete next[threadId]
        continue
      }
      const at = clock()
      next[threadId] = {
        key: `${threadId}:${result.turnId ?? 'turn'}:${at}`,
        outcome: result.outcome,
        message: result.message,
        at,
      }
    }
    if (next) usePetReactionStore.setState({ reactions: next })
  })
}

export function useAgentPetSignal(): AgentPetSignal {
  useEffect(() => watchPetReactions(), [])
  const threadId = useAgentStore((s) => s.activeThreadId)
  const view = useAgentStore((s) => (s.activeThreadId ? s.views[s.activeThreadId] : undefined))
  const reaction = usePetReactionStore((s) => (threadId ? s.reactions[threadId] : undefined))
  return useMemo(
    () => ({
      threadId: threadId ?? undefined,
      streaming: view?.isStreaming ?? false,
      approval: view?.pendingApprovals[0]?.summary,
      activity: runningActivity(view),
      reaction,
    }),
    [threadId, view, reaction],
  )
}

/** Reset module state (tests). */
export function __resetPetSignalForTests(): void {
  unwatch?.()
  unwatch = undefined
  usePetReactionStore.setState({ reactions: {} })
}
