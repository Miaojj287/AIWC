/**
 * Agent → pet status counts (the Codex-style readout beside the pet): threads running, waiting for the user,
 * finished or failed while unseen (threadAttention marks, cleared when the thread is opened), plus unread WeChat
 * messages. Kept out of agentStore (file ceiling, AGENTS.md §2.3); the derivation is pure and tested.
 */
import { useMemo } from 'react'
import { asThreadId, type ThreadId } from '@aiwc/protocol'
import type { PetFleet } from '@/features/pets'
import { useConfig } from '@/platform/configStore'
import { useWechatUnread, type WechatUnread } from '@/platform/wechatUnread'
import { useAgentStore } from './agentStore'
import type { ThreadViewState } from './model'
import { useThreadAttention, type AttentionMark } from './threadAttention'

export interface FleetInput {
  /** Desktop threads in display order (pinned, then most recent). */
  threads: readonly { threadId: ThreadId }[]
  views: Readonly<Record<string, Pick<ThreadViewState, 'isStreaming' | 'pendingApprovals' | 'pendingQuestions'>>>
  marks: Readonly<Record<string, AttentionMark>>
  /** The thread on screen right now (null when none is); it is never a click target — it is already open. */
  viewing: ThreadId | null
  unread?: WechatUnread
}

/** Counts and click targets for the pet readout. Pure (tested). */
export function deriveFleet({ threads, views, marks, viewing, unread }: FleetInput): PetFleet {
  const fleet: PetFleet = { running: 0, waiting: 0, done: 0, failed: 0, targets: {}, unread }
  const note = (kind: 'running' | 'waiting' | 'done' | 'failed', threadId: ThreadId) => {
    fleet[kind] += 1
    if (threadId !== viewing) fleet.targets[kind] ??= threadId
  }
  // Every live view counts (a scheduled run opened in the panel is a running thread too); listed threads first so
  // the click target is the most recent one.
  const order = [...new Set<string>([...threads.map((thread) => thread.threadId), ...Object.keys(views)])]
  const listed = new Set<string>(threads.map((thread) => thread.threadId))
  for (const id of order) {
    const threadId = asThreadId(id)
    const view = views[id]
    if (view?.pendingApprovals.length || view?.pendingQuestions?.length) note('waiting', threadId)
    else if (view?.isStreaming) note('running', threadId)
    else if (listed.has(id) && marks[id] === 'unread') note('done', threadId)
    else if (listed.has(id) && marks[id] === 'failed') note('failed', threadId)
  }
  return fleet
}

/** The live readout for the pet; WeChat unread is only fetched while that count is switched on. */
export function useAgentPetFleet(): PetFleet {
  const threads = useAgentStore((s) => s.threads)
  const views = useAgentStore((s) => s.views)
  const marks = useThreadAttention((s) => s.marks)
  const viewing = useThreadAttention((s) => s.viewing)
  const wantUnread = useConfig((c) => c.pet.enabled && c.pet.showUnread) ?? false
  const unread = useWechatUnread(wantUnread)
  return useMemo(
    () => deriveFleet({ threads, views, marks, viewing, unread }),
    [threads, views, marks, viewing, unread],
  )
}
