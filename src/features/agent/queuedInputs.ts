/**
 * Messages queued while a turn runs (⌥↵ or the queue button): unlike a send, which steers the running turn, a queued
 * message waits and starts its own turn once the current one completes — one per completed turn, in order. A turn
 * that stops early (interrupted, error, step cap) leaves the queue on hold so nothing is fired after the user pressed
 * stop; the items stay editable and can be sent by hand. Kept for the app session (memory only), per thread.
 * The store is plain zustand; agentEvents.ts calls `takeQueuedInput` on turn.completed.
 */
import { create } from 'zustand'
import type { ThreadId } from '@aiwc/protocol'
import { addMention } from './mentions'
import { emptyDraft, type ComposerDraft } from './model'

export interface QueuedInput {
  id: string
  draft: ComposerDraft
  createdAt: number
}

interface QueueState {
  queues: Record<string, QueuedInput[]>
  /** Threads whose last turn stopped early: their queue waits for the user. */
  held: Record<string, true>
  enqueue(threadId: ThreadId, draft: ComposerDraft): void
  remove(threadId: ThreadId, id: string): void
  /** Remove and return one item (送出 / 编辑). */
  take(threadId: ThreadId, id: string): QueuedInput | undefined
  setHeld(threadId: ThreadId, held: boolean): void
}

let counter = 0
const without = (list: QueuedInput[] | undefined, id: string): QueuedInput[] => (list ?? []).filter((q) => q.id !== id)

export const useQueueStore = create<QueueState>((set, get) => ({
  queues: {},
  held: {},
  enqueue(threadId, draft) {
    const item: QueuedInput = { id: `q_${Date.now().toString(36)}_${counter++}`, draft, createdAt: Date.now() }
    set((s) => ({ queues: { ...s.queues, [threadId]: [...(s.queues[threadId] ?? []), item] } }))
  },
  remove(threadId, id) {
    set((s) => ({ queues: { ...s.queues, [threadId]: without(s.queues[threadId], id) } }))
  },
  take(threadId, id) {
    const item = get().queues[threadId]?.find((q) => q.id === id)
    if (item) get().remove(threadId, id)
    return item
  },
  setHeld(threadId, held) {
    set((s) => {
      if (Boolean(s.held[threadId]) === held) return s
      const next = { ...s.held }
      if (held) next[threadId] = true
      else delete next[threadId]
      return { held: next }
    })
  },
}))

const NO_QUEUE: readonly QueuedInput[] = []

/** The queue of one thread (stable empty array when none). */
export const useQueuedInputs = (threadId: ThreadId | null | undefined): readonly QueuedInput[] =>
  useQueueStore((s) => (threadId ? (s.queues[threadId] ?? NO_QUEUE) : NO_QUEUE))

export const useQueueHeld = (threadId: ThreadId | null | undefined): boolean =>
  useQueueStore((s) => Boolean(threadId && s.held[threadId]))

/**
 * A turn ended. Completed: the next queued message (if any) is removed and returned for sending. Stopped early: the
 * queue is put on hold and nothing is returned.
 */
export function takeQueuedInput(threadId: ThreadId, completed: boolean): ComposerDraft | undefined {
  const store = useQueueStore.getState()
  if (!completed) {
    if (store.queues[threadId]?.length) store.setHeld(threadId, true)
    return undefined
  }
  const next = store.queues[threadId]?.[0]
  if (!next) return undefined
  store.setHeld(threadId, false)
  store.remove(threadId, next.id)
  return next.draft
}

/** Merge a queued message back into a draft (编辑): text appended after what is there, chips and files added. */
export function mergeIntoDraft(current: ComposerDraft | undefined, queued: ComposerDraft): ComposerDraft {
  const base = current ?? emptyDraft()
  return {
    text: [base.text, queued.text].filter((x) => x.trim()).join('\n\n'),
    mentions: queued.mentions.reduce((list, m) => addMention(list, m), base.mentions),
    attachments: [...(base.attachments ?? []), ...(queued.attachments ?? [])],
  }
}

/** Forget every queue (tests). */
export function __resetQueueForTests(): void {
  useQueueStore.setState({ queues: {}, held: {} })
}
