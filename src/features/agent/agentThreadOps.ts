/**
 * Thread operations of agentStore that touch one thread's metadata or history rather than the live conversation, kept
 * apart so the store stays under the file ceiling (AGENTS.md §2.3): paging the history, revealing a search hit,
 * rename / pin / delete / export, and fetching a compaction summary.
 */
import type { StoreApi } from 'zustand'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { invoke } from '@/platform/hooks'
import type { AgentState } from './agentStore'
import { errorMessage, mergeThreadPage, THREAD_PAGE } from './agentStoreSupport'
import type { ThreadViewState } from './model'

export interface StoreContext {
  get: () => AgentState
  set: StoreApi<AgentState>['setState']
  patchView(threadId: ThreadId, fn: (v: ThreadViewState) => ThreadViewState): void
  patchSummary(threadId: ThreadId, fn: (t: ThreadSummary) => ThreadSummary): void
  summaryOf(threadId: ThreadId): ThreadSummary | undefined
}

export type ThreadOps = Pick<
  AgentState,
  | 'loadMoreThreads'
  | 'revealItem'
  | 'clearFocusItem'
  | 'rename'
  | 'pin'
  | 'remove'
  | 'exportThread'
  | 'loadCompactionSummary'
>

export function createThreadOps(ctx: StoreContext): ThreadOps {
  return {
    async loadMoreThreads() {
      if (!ctx.get().hasMoreThreads || ctx.get().loadingMoreThreads) return
      ctx.set({ loadingMoreThreads: true })
      try {
        const offset = ctx.get().threadsOffset
        const page = await invoke('agent:listThreads', { channel: 'desktop', limit: THREAD_PAGE, offset })
        ctx.set((s) => ({
          threads: mergeThreadPage(s.threads, page),
          hasMoreThreads: page.length >= THREAD_PAGE,
          threadsOffset: offset + page.length,
        }))
      } catch (e) {
        toast.error(t('agent.history.loadMoreFailed', { detail: errorMessage(e) }))
      } finally {
        ctx.set({ loadingMoreThreads: false })
      }
    },

    revealItem(threadId, itemId) {
      ctx.get().openThread(threadId)
      ctx.patchView(threadId, (v) => ({ ...v, focusItemId: itemId }))
    },

    clearFocusItem(threadId) {
      ctx.patchView(threadId, (v) => (v.focusItemId ? { ...v, focusItemId: undefined } : v))
    },

    async rename(threadId, title) {
      const trimmed = title.trim()
      if (!trimmed) return
      const before = ctx.summaryOf(threadId)?.title
      ctx.patchSummary(threadId, (t) => ({ ...t, title: trimmed }))
      if (ctx.get().localIds.includes(threadId)) {
        ctx.patchSummary(threadId, (t) => ({ ...t, settings: { ...t.settings, title: trimmed } }))
        return
      }
      try {
        await invoke('agent:renameThread', { threadId, title: trimmed })
      } catch (e) {
        if (before !== undefined) ctx.patchSummary(threadId, (t) => ({ ...t, title: before }))
        toast.error(t('agent.toast.renameFailed', { detail: errorMessage(e) }))
      }
    },

    async pin(threadId, pinned) {
      ctx.patchSummary(threadId, (t) => ({ ...t, pinned }))
      if (ctx.get().localIds.includes(threadId)) return
      try {
        await invoke('agent:pinThread', { threadId, pinned })
      } catch (e) {
        ctx.patchSummary(threadId, (t) => ({ ...t, pinned: !pinned }))
        toast.error(t('common.operationFailedDetail', { detail: errorMessage(e) }))
      }
    },

    async remove(threadId) {
      if (ctx.get().localIds.includes(threadId)) {
        ctx.get().closeThread(threadId)
        return
      }
      try {
        await invoke('agent:deleteThread', { threadId })
      } catch (e) {
        toast.error(t('agent.toast.deleteFailed', { detail: errorMessage(e) }))
        return
      }
      ctx.get().closeThread(threadId)
      ctx.set((s) => {
        const views = { ...s.views }
        const drafts = { ...s.drafts }
        delete views[threadId]
        delete drafts[threadId]
        return { threads: s.threads.filter((t) => t.threadId !== threadId), views, drafts }
      })
      toast.success(t('agent.toast.deleted'))
    },

    async exportThread(threadId, options) {
      try {
        const { path } = await invoke('agent:exportThread', { threadId, ...(options ? { options } : {}) })
        toast.success(t('agent.toast.exported'), {
          detail: path,
          action: { label: t('agent.toast.showExport'), onClick: () => void invoke('file:reveal', { path }) },
        })
      } catch (e) {
        toast.error(t('agent.toast.exportFailed', { detail: errorMessage(e) }))
      }
    },

    async loadCompactionSummary(threadId, itemId) {
      const view = ctx.get().views[threadId]
      const known = view?.items.find(
        (it) => it.kind === 'compaction' && (it.id === itemId || it.summaryItemId === itemId),
      )
      if (known?.kind === 'compaction' && known.summary) return known.summary
      try {
        const { items } = await invoke('agent:getThread', { threadId })
        const found = items.find((h) => h.type === 'compaction_summary' && h.id === itemId)
        const summary = found?.type === 'compaction_summary' ? found.summary : undefined
        if (summary)
          ctx.patchView(threadId, (v) => ({
            ...v,
            items: v.items.map((it) =>
              it.kind === 'compaction' && it.summaryItemId === itemId ? { ...it, summary } : it,
            ),
          }))
        return summary
      } catch {
        return undefined
      }
    },
  }
}
