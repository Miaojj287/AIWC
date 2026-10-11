/**
 * 设置 › 记忆 › 待确认 as the renderer sees it: hydrated once from 'memoryReview:list', then replaced by every
 * 'memoryReview:changed' push. The page and the settings nav badge read the same store (one subscription).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { MemoryProposal } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'

interface MemoryReviewState {
  items: MemoryProposal[]
  status: 'idle' | 'loading' | 'ready' | 'error'
}

export const useMemoryReviewStore = create<MemoryReviewState>(() => ({ items: [], status: 'idle' }))

let subscription: Promise<void> | undefined

/** Subscribe once per window; a failed first load can be retried (the subscription is dropped on failure). */
export function ensureMemoryReview(): Promise<void> {
  subscription ??= getBridge()
    .then(async (bridge) => {
      useMemoryReviewStore.setState({ status: 'loading' })
      bridge.on('memoryReview:changed', ({ items }) => useMemoryReviewStore.setState({ items, status: 'ready' }))
      const items = await bridge.invoke('memoryReview:list', undefined)
      useMemoryReviewStore.setState({ items, status: 'ready' })
    })
    .catch(() => {
      subscription = undefined
      useMemoryReviewStore.setState({ status: 'error' })
    })
  return subscription
}

/** The pending list (and its load state) for a component; starts the subscription on mount. */
export function useMemoryReview(): MemoryReviewState {
  useEffect(() => {
    void ensureMemoryReview()
  }, [])
  const items = useMemoryReviewStore((s) => s.items)
  const status = useMemoryReviewStore((s) => s.status)
  return { items, status }
}

export function __resetMemoryReviewForTests(): void {
  subscription = undefined
  useMemoryReviewStore.setState({ items: [], status: 'idle' })
}
