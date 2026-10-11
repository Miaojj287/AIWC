/**
 * agentStore operations on the conversation's history rather than its live stream, kept apart so the store stays
 * under the file ceiling (AGENTS.md §2.3): rewinding to a turn to edit or regenerate it (thread.rollback, then the
 * turn runs again), forking a new thread at a turn, archiving, and quoting selected text into the composer.
 */
import { newClientInputId, type ItemId, type ThreadId, type ThreadSummary, type UserInput } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage, sortThreads, THREAD_PAGE } from './agentStoreSupport'
import type { StoreContext } from './agentThreadOps'
import type { ContextRef } from './contextRef'
import { addMention } from './mentions'
import { emptyDraft, isUntitledTitle, type ThreadViewState } from './model'
import { addPendingInput, pendingInputsOf, withoutPendingInput } from './pendingInputs'
import { quoteBlock } from './quoteText'
import { rewindPoint } from './rewind'

export interface QuoteTextPayload {
  text: string
  /** Where the text was selected (a chat, a file): added as an @ chip next to the quote. */
  source?: ContextRef & { messageIds?: string[] }
}

export interface ConversationState {
  /** The 已归档 list (loaded on demand). */
  archived: ThreadSummary[]
  archivedLoaded: boolean
  archivedLoading: boolean
  loadArchived(): Promise<void>
  /** 归档 / 取消归档: archived threads leave the history list (and the tab strip) but still open from 已归档. */
  archive(threadId: ThreadId, archived: boolean): Promise<void>
  /**
   * 编辑 / 重新生成: drop the user message `fromItemId` and everything after it (kernel thread.rollback), then run
   * `input` as the new turn. Resolves false when nothing was changed (unknown item, kernel refusal).
   */
  rewindTurn(threadId: ThreadId, fromItemId: string, input: UserInput): Promise<boolean>
  /** 从这一轮分出新会话: a new thread holding the history through the turn of `itemId`, opened and focused. */
  forkFromTurn(threadId: ThreadId, itemId: string): Promise<void>
  /** 引用到 Agent with a text selection: a blockquote into the active composer, plus the source as an @ chip. */
  quoteText(payload: QuoteTextPayload): Promise<void>
}

export const conversationInitialState: Pick<ConversationState, 'archived' | 'archivedLoaded' | 'archivedLoading'> = {
  archived: [],
  archivedLoaded: false,
  archivedLoading: false,
}

/** A turn is running or a send has not been recorded yet: 编辑 / 重新生成 must wait. */
export const isRewindBusy = (view: ThreadViewState | undefined): boolean =>
  Boolean(view?.isStreaming || view?.currentTurnId || pendingInputsOf(view).length > 0)

const titleOf = (s: ThreadSummary | undefined) =>
  s && !isUntitledTitle(s.title) ? s.title : t('agent.thread.untitled')

export function createConversationOps(ctx: StoreContext): ConversationState {
  /** Start a turn with exactly this input (a rewound turn keeps its attachments), shown pending until recorded. */
  async function rerun(threadId: ThreadId, input: UserInput): Promise<void> {
    const clientInputId = newClientInputId()
    ctx.patchView(threadId, (v) =>
      addPendingInput(v, { clientInputId, ...input, mode: 'start', createdAt: Date.now() }),
    )
    try {
      await invoke('agent:submit', { type: 'turn.start', threadId, input, mode: 'start', clientInputId })
      ctx.patchSummary(threadId, (s) => ({ ...s, updatedAt: Date.now() }))
    } catch (e) {
      ctx.patchView(threadId, (v) => ({ ...v, pendingInputs: withoutPendingInput(v.pendingInputs, clientInputId) }))
      toast.error(t('agent.toast.sendFailed', { detail: errorMessage(e) }))
    }
  }

  return {
    ...conversationInitialState,

    async loadArchived() {
      if (ctx.get().archivedLoading) return
      ctx.set({ archivedLoading: true })
      try {
        const list = await invoke('agent:listArchivedThreads', { limit: THREAD_PAGE })
        ctx.set({ archived: list, archivedLoaded: true })
      } catch (e) {
        toast.error(t('agent.stream.archive.loadFailed', { detail: errorMessage(e) }))
      } finally {
        ctx.set({ archivedLoading: false })
      }
    },

    async archive(threadId, archived) {
      if (ctx.get().localIds.includes(threadId)) return
      const summary = ctx.summaryOf(threadId) ?? ctx.get().archived.find((s) => s.threadId === threadId)
      try {
        await invoke('agent:archiveThread', { threadId, archived })
      } catch (e) {
        toast.error(t('common.operationFailedDetail', { detail: errorMessage(e) }))
        return
      }
      if (archived) {
        if (ctx.get().openIds.includes(threadId)) ctx.get().closeThread(threadId)
        ctx.set((s) => ({
          threads: s.threads.filter((x) => x.threadId !== threadId),
          archived: summary
            ? [{ ...summary, archived: true }, ...s.archived.filter((x) => x.threadId !== threadId)]
            : s.archived,
        }))
        toast.success(t('agent.stream.archive.done', { title: titleOf(summary) }), {
          action: { label: t('agent.stream.archive.undo'), onClick: () => void ctx.get().archive(threadId, false) },
        })
        return
      }
      ctx.set((s) => {
        const restored = summary ? { ...summary, archived: undefined } : undefined
        const rest = s.threads.filter((x) => x.threadId !== threadId)
        return {
          archived: s.archived.filter((x) => x.threadId !== threadId),
          threads: restored ? sortThreads([restored, ...rest]) : rest,
        }
      })
      toast.success(t('agent.stream.archive.restored', { title: titleOf(summary) }))
    },

    async rewindTurn(threadId, fromItemId, input) {
      const view = ctx.get().views[threadId]
      if (!view || ctx.get().localIds.includes(threadId)) return false
      // Checked again here because a confirm dialog may have stood open meanwhile: rolling back now would interrupt
      // the running turn or drop a send still on its way (turn.start sent, turn.started not yet back).
      if (isRewindBusy(view)) {
        toast.info(t('agent.stream.rewind.busy'))
        return false
      }
      const point = rewindPoint(view.items, fromItemId)
      if (!point) return false
      // Optimistic: the turns go at once; the kernel's rewritten history is the same prefix.
      ctx.patchView(threadId, (v) => ({
        ...v,
        items: v.items.slice(0, point.index),
        pendingInputs: undefined,
        focusItemId: undefined,
      }))
      try {
        await invoke('agent:submit', {
          type: 'thread.rollback',
          threadId,
          turns: point.turns,
          fromItemId: fromItemId as ItemId,
        })
      } catch (e) {
        ctx.set((s) => ({ views: { ...s.views, [threadId]: view } }))
        toast.error(t('agent.stream.rewind.failed', { detail: errorMessage(e) }))
        return false
      }
      await rerun(threadId, input)
      return true
    },

    async forkFromTurn(threadId, itemId) {
      const source = ctx.summaryOf(threadId)
      try {
        const summary = await invoke('agent:forkThread', {
          threadId,
          throughItemId: itemId as ItemId,
          title: t('agent.stream.fork.title', { title: titleOf(source) }),
        })
        ctx.set((s) => ({
          threads: sortThreads([summary, ...s.threads.filter((x) => x.threadId !== summary.threadId)]),
        }))
        ctx.get().openThread(summary.threadId)
        ctx.get().requestFocus()
        toast.success(t('agent.stream.fork.done'))
      } catch (e) {
        toast.error(t('agent.stream.fork.failed', { detail: errorMessage(e) }))
      }
    },

    async quoteText({ text, source }) {
      const block = quoteBlock(text)
      if (!block) return
      const threadId = await ctx.get().ensureActiveThread()
      ctx.set((s) => {
        const draft = s.drafts[threadId] ?? emptyDraft()
        const mentions = source
          ? addMention(draft.mentions, {
              kind: source.kind,
              id: source.id,
              label: source.label,
              ...(source.messageIds?.length ? { messageIds: source.messageIds } : {}),
            })
          : draft.mentions
        const body = draft.text.trimEnd()
        return {
          drafts: { ...s.drafts, [threadId]: { ...draft, text: `${body ? `${body}\n\n` : ''}${block}\n\n`, mentions } },
        }
      })
      ctx.get().requestFocus()
    },
  }
}
