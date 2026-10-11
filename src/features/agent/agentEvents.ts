/**
 * agentStore's handler for the single 'agent:event' subscription: thread-list changes it applies itself, everything
 * else folded into the thread's view by reducer.ts, then the side effects decided from the same event (toasts, the
 * unread dot, opening a generated file) — never from inside the reducer. Kept apart so the store stays under the
 * file ceiling (AGENTS.md §2.3).
 */
import type { Event } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useShellStore } from '@/shell/shellStore'
import type { AgentState } from './agentStore'
import { sortThreads } from './agentStoreSupport'
import type { StoreContext } from './agentThreadOps'
import { artifactToOpen, shouldAutoOpen } from './artifactAutoOpen'
import { takeQueuedInput } from './queuedInputs'
import { usageRatio, USAGE_WARN_RATIO } from './model'
import { reduceEvent } from './reducer'
import { applyChildEvent, noteSubagent, parentOfChild } from './renderEvents'
import { draftFromInputs, droppedPendingInputs, mergeRestoredDraft } from './restoreInput'
import { noteThreadAttention } from './threadAttention'

export function createEventHandler(ctx: StoreContext): AgentState['handleEvent'] {
  return (e: Event) => {
    const { threadId } = e
    switch (e.type) {
      case 'thread.created': {
        if (e.origin.channel !== 'desktop' || ctx.summaryOf(threadId)) return
        const now = Date.now()
        ctx.set((s) => ({
          threads: sortThreads([
            {
              threadId,
              title: e.settings.title ?? '',
              origin: e.origin,
              settings: e.settings,
              createdAt: now,
              updatedAt: now,
              pinned: false,
              contextRef: e.origin.contextRef,
            },
            ...s.threads,
          ]),
        }))
        return
      }
      case 'thread.settings':
        ctx.patchSummary(threadId, (t) => ({ ...t, settings: e.settings }))
        return
      case 'thread.title':
        ctx.patchSummary(threadId, (t) => ({ ...t, title: e.title }))
        return
      case 'memory.written':
        toast.success(
          t('agent.toast.memoryWritten', { count: e.count, file: `${e.file}${e.file.endsWith('.md') ? '' : '.md'}` }),
          {
            action: { label: t('common.view'), onClick: () => runCommand('tab.openSettings', { page: 'memory' }) },
          },
        )
        return
      default:
        break
    }

    if (e.type === 'subagent') noteSubagent(e)
    // A running sub-agent's own events fold into its run under the parent's tool row.
    const parentId = ctx.get().views[threadId] ? undefined : parentOfChild(threadId)
    if (parentId) {
      const parent = ctx.get().views[parentId]
      if (!parent) return
      const items = applyChildEvent(parent.items, threadId, e, reduceEvent)
      if (items !== parent.items) ctx.set((s) => ({ views: { ...s.views, [parentId]: { ...parent, items } } }))
      return
    }

    noteThreadAttention(e, ctx.summaryOf(threadId)?.origin.channel)
    const view = ctx.get().views[threadId]
    if (!view) return
    const next = reduceEvent(view, e)
    if (next !== view) ctx.set((s) => ({ views: { ...s.views, [threadId]: next } }))
    // Input the turn never recorded goes back into the composer (restoreInput.ts).
    const lost = e.type === 'turn.aborted' ? droppedPendingInputs(view, e.droppedClientInputIds) : []
    if (lost.length > 0)
      ctx.set((s) => ({
        drafts: { ...s.drafts, [threadId]: mergeRestoredDraft(s.drafts[threadId], draftFromInputs(lost)) },
      }))

    if (e.type === 'turn.completed' || e.type === 'item.user')
      ctx.patchSummary(threadId, (t) => ({ ...t, updatedAt: Date.now() }))
    // A queued message starts its own turn once this one completes; a turn stopped early holds the queue. A host note
    // (定时任务 reminder) is not the user's turn: it neither releases nor holds the queue.
    if ((e.type === 'turn.completed' || e.type === 'turn.aborted') && e.kind !== 'note') {
      const queued = takeQueuedInput(threadId, e.type === 'turn.completed')
      if (queued) void ctx.get().send(threadId, queued)
    }

    // side effects decided from the event, never from inside the reducer
    const channel = ctx.summaryOf(threadId)?.origin.channel
    const opened = e.type === 'turn.completed' ? artifactToOpen(next, e.turnId) : undefined
    if (
      opened?.path &&
      shouldAutoOpen({ threadId, activeThreadId: ctx.get().activeThreadId, collapsed: ctx.get().collapsed, channel })
    )
      runCommand('tab.openFile', { path: opened.path, title: opened.title })
    if (e.type === 'context.usage' && usageRatio(e.usage) >= USAGE_WARN_RATIO && !view.usageWarned) {
      ctx.patchView(threadId, (v) => ({ ...v, usageWarned: true }))
      toast.warning(t('agent.toast.usageHigh', { percent: Math.round(usageRatio(e.usage) * 100) }), {
        action: { label: t('agent.context.compact'), onClick: () => void ctx.get().compact(threadId) },
      })
    }
    if (
      ctx.get().collapsed &&
      (e.type === 'text.end' || e.type === 'turn.completed' || e.type === 'approval.requested' || e.type === 'error')
    ) {
      useShellStore.getState().setAgentUnread(true)
    }
  }
}
