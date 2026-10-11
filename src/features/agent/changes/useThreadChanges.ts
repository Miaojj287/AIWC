/**
 * A thread's change journal for 本轮改动: loaded once per thread (not per turn) and refreshed when the main process
 * records or undoes a change of that thread.
 */
import { useMemo } from 'react'
import type { AgentChange, ThreadId, TurnId } from '@aiwc/protocol'
import { useBridgeEvent, useInvoke } from '@/platform/hooks'
import { changesByTurn } from './changesModel'

export interface ThreadChanges {
  byTurn: ReadonlyMap<TurnId, AgentChange[]>
  reload: () => void
}

const NONE: ReadonlyMap<TurnId, AgentChange[]> = new Map()

export function useThreadChanges(threadId: ThreadId | undefined): ThreadChanges {
  const result = useInvoke('privacy:listChanges', { threadId: threadId ?? ('' as ThreadId) }, [threadId], {
    enabled: threadId !== undefined,
  })
  const { reload } = result
  useBridgeEvent('privacy:changes', (e) => {
    if (e.threadId === threadId) reload()
  })
  const byTurn = useMemo(() => (result.data ? changesByTurn(result.data) : NONE), [result.data])
  return { byTurn, reload }
}
