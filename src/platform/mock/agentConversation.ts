/**
 * Mock of the Agent conversation channels (ipcDomains/conversation.ts) and of thread.rollback, over the scripted
 * agent's in-memory threads (mock/agent.ts): archive / 已归档 list / fork, mirroring the kernel's rules.
 */
import { newThreadId, type HistoryItem, type Op, type ThreadId, type ThreadSummary, type TurnId } from '@aiwc/protocol'
import type { HandlersFor } from './core'

export type ConversationChannel = 'agent:archiveThread' | 'agent:listArchivedThreads' | 'agent:forkThread'

interface MockThread {
  summary: ThreadSummary
  items: HistoryItem[]
  turns: number
  running?: { turnId: TurnId }
}

export interface ConversationMockDeps<T extends MockThread> {
  threads: Map<ThreadId, T>
  get(threadId: ThreadId): T
  /** A new empty thread record registered under `threadId` (the scripted agent's own constructor). */
  create(threadId: ThreadId, summary: ThreadSummary): T
  now(): number
}

const turnOf = (item: HistoryItem): TurnId | null | undefined => ('turnId' in item ? item.turnId : undefined)

/** thread.rollback on a mock thread: `fromItemId` drops that user message onward, else the last `turns` turns. */
export function rollbackMockItems(items: HistoryItem[], op: Extract<Op, { type: 'thread.rollback' }>): HistoryItem[] {
  if (op.fromItemId) {
    const cut = items.findIndex((it) => it.id === op.fromItemId && it.type === 'user_message')
    if (cut < 0) throw Object.assign(new Error('rollback target not in history'), { code: 'rollback_target_missing' })
    return items.slice(0, cut)
  }
  const turnIds = [...new Set(items.map(turnOf).filter((id): id is TurnId => Boolean(id)))]
  const drop = new Set(turnIds.slice(-op.turns))
  return items.filter((it) => {
    const turnId = turnOf(it)
    return !(turnId && drop.has(turnId))
  })
}

export function conversationHandlers<T extends MockThread>(
  deps: ConversationMockDeps<T>,
): Pick<HandlersFor<'agent'>, ConversationChannel> {
  return {
    'agent:archiveThread': ({ threadId, archived }) => {
      const rec = deps.get(threadId)
      rec.summary = { ...rec.summary, archived: archived || undefined }
    },
    'agent:listArchivedThreads': (req) => {
      const offset = req?.offset ?? 0
      return [...deps.threads.values()]
        .map((t) => t.summary)
        .filter((s) => s.archived && s.origin.channel === 'desktop')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(offset, offset + (req?.limit ?? 50))
    },
    'agent:forkThread': ({ threadId, throughItemId, title }) => {
      const source = deps.get(threadId)
      const at = source.items.findIndex((it) => it.id === throughItemId)
      if (at < 0) throw new Error('fork_target_missing')
      const turnId = turnOf(source.items[at]!)
      if (turnId && source.running?.turnId === turnId) throw new Error('fork_turn_running')
      let end = at
      if (turnId) for (let i = at + 1; i < source.items.length; i++) if (turnOf(source.items[i]!) === turnId) end = i
      const now = deps.now()
      const id = newThreadId()
      const rec = deps.create(id, {
        ...source.summary,
        threadId: id,
        title,
        settings: { ...source.summary.settings, title },
        createdAt: now,
        updatedAt: now,
        pinned: false,
        archived: undefined,
      })
      rec.items = source.items.slice(0, end + 1)
      rec.turns = new Set(rec.items.map(turnOf).filter(Boolean)).size
      return rec.summary
    },
  }
}
