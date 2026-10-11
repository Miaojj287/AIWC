/**
 * Agent panel state (zustand). Threads come from agent:listThreads / agent:getThread; live changes
 * arrive on the single 'agent:event' subscription and are folded by reducer.ts. Everything that
 * talks to the kernel goes through `agent:submit` with a protocol Op — there is no other path.
 */
import { create } from 'zustand'
import {
  MAX_QUOTED_MESSAGES,
  newClientInputId,
  newThreadId,
  type ApprovalDecision,
  type ApprovalId,
  type Event,
  type InvokeRes,
  type Mention,
  type Op,
  type SkillSummary,
  type ThreadExportOptions,
  type ThreadId,
  type ThreadSettings,
  type ThreadSummary,
} from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { getBridge } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { useShellStore } from '@/shell/shellStore'
import { errorMessage, sortThreads, THREAD_PAGE, threadSettingsFromConfig } from './agentStoreSupport'
import { createEventHandler } from './agentEvents'
import { conversationInitialState, createConversationOps, type ConversationState } from './agentConversationOps'
import { createThreadOps, type StoreContext } from './agentThreadOps'
import { activeTabContextRef, mentionFromContextRef, type ContextRef } from './contextRef'
import { addMention, buildUserInput } from './mentions'
import {
  createThreadView,
  emptyDraft,
  isUntitledTitle,
  SCRATCH_DRAFT_KEY,
  type ApprovalExtra,
  type ComposerDraft,
  type ThreadViewState,
} from './model'
import { addPendingInput, sendModeFor, withoutPendingInput } from './pendingInputs'
import { mergeRestoredDraft } from './restoreInput'
import { reduceEvent } from './reducer'
import { mergeLoadedView } from './threadLoad'
import { clearSavedTabs, readSavedTabs, settleRestoredTabs, watchOpenTabs } from './threadRestore'

export type ModelOption = InvokeRes<'agent:listModels'>[number]

export interface AgentState extends ConversationState {
  /** Desktop threads, pinned first then most recent. */
  threads: ThreadSummary[]
  /** Threads shown as tabs in the panel strip (subset of `threads`). */
  localIds: ThreadId[]
  openIds: ThreadId[]
  activeThreadId: ThreadId | null
  views: Record<string, ThreadViewState>
  drafts: Record<string, ComposerDraft>
  /** Bumped whenever something asks the composer to take focus. */
  focusSeq: number
  hydrated: boolean
  hydrating: boolean
  loadError?: string
  /** The last history page was full: there may be older threads (loadMoreThreads). */
  hasMoreThreads: boolean
  loadingMoreThreads: boolean
  /** History rows fetched so far: the offset of the next page. */
  threadsOffset: number
  models: ModelOption[]
  skills: SkillSummary[]
  /** Mirrors the panel's collapsed prop so events can raise the unread dot. */
  collapsed: boolean

  hydrate(): Promise<void>
  /** Next page of the history (older threads). */
  loadMoreThreads(): Promise<void>
  /** Open a thread scrolled to one of its items (a search hit). */
  revealItem(threadId: ThreadId, itemId: string): void
  /** The transcript scrolled to the revealed item (or gave up): forget the request. */
  clearFocusItem(threadId: ThreadId): void
  loadThread(threadId: ThreadId): Promise<void>
  loadModels(): Promise<void>
  loadSkills(): Promise<void>
  /** Show a thread as a tab (loads history when needed) and optionally activate it. */
  openThread(threadId: ThreadId, opts?: { activate?: boolean }): void
  /** Remove the tab; the thread itself stays in history. */
  closeThread(threadId: ThreadId): void
  closeOtherThreads(threadId: ThreadId): void
  setActive(threadId: ThreadId): void
  createThread(opts?: { contextRef?: ContextRef; focus?: boolean }): Promise<ThreadId>
  /** Active thread, or a new one when the strip is empty. */
  ensureActiveThread(): Promise<ThreadId>
  /** Send the current draft (or an explicit input) as a turn. */
  send(threadId: ThreadId, input?: ComposerDraft): Promise<void>
  /**
   * Composer submit — Enter, ⌘Enter and the send button all end here. With an open thread it sends that
   * thread's draft; otherwise it turns the scratch draft into a new thread bound to the active workspace
   * tab (its context chip first, then the scratch mentions) and sends it.
   */
  sendDraft(): Promise<void>
  interrupt(threadId: ThreadId): Promise<void>
  resolveApproval(
    threadId: ThreadId,
    approvalId: ApprovalId,
    decision: ApprovalDecision,
    extra?: ApprovalExtra,
  ): Promise<void>
  updateSettings(threadId: ThreadId, patch: Partial<ThreadSettings>): Promise<void>
  /** `instructions`: what `/compact …` asked the summary to keep. */
  compact(threadId: ThreadId, instructions?: string): Promise<void>
  clearContext(threadId: ThreadId): Promise<void>
  rename(threadId: ThreadId, title: string): Promise<void>
  pin(threadId: ThreadId, pinned: boolean): Promise<void>
  remove(threadId: ThreadId): Promise<void>
  /** Options default to the privacy-safe export (SAFE_THREAD_EXPORT). */
  exportThread(threadId: ThreadId, options?: ThreadExportOptions): Promise<void>
  /** Summary text of a compaction item (fetched from history when the live event only had an id). */
  loadCompactionSummary(threadId: ThreadId, itemId: string): Promise<string | undefined>
  setDraft(threadId: ThreadId, patch: Partial<ComposerDraft>): void
  addMentionToDraft(threadId: ThreadId, mention: Mention): void
  requestFocus(): void
  setCollapsed(collapsed: boolean): void
  /** Fold one kernel event (public for the subscription and tests). */
  handleEvent(e: Event): void
  /** 'agent.quote' — chip into the active thread's composer (creating a thread when none is open). */
  quote(payload: { kind: Mention['kind']; id: string; label: string; messageIds?: string[] }): Promise<void>
  /** 'agent.newThread' — new thread bound to the given / active workspace object, composer focused. */
  newThread(payload?: { contextRef?: ContextRef }): Promise<ThreadId>
}

const submit = (op: Op) => invoke('agent:submit', op)

let subscribed = false
let unsubscribe: (() => void) | undefined

/** Subscribe to 'agent:event' exactly once for the app lifetime. */
export function subscribeAgentEvents(): void {
  if (subscribed) return
  subscribed = true
  void getBridge().then((b) => {
    unsubscribe = b.on('agent:event', (e) => useAgentStore.getState().handleEvent(e))
  })
}

export const useAgentStore = create<AgentState>((set, get) => {
  const patchView = (threadId: ThreadId, fn: (v: ThreadViewState) => ThreadViewState) => {
    const current = get().views[threadId]
    if (!current) return
    set((s) => ({ views: { ...s.views, [threadId]: fn(current) } }))
  }
  const patchSummary = (threadId: ThreadId, fn: (t: ThreadSummary) => ThreadSummary) => {
    set((s) => ({ threads: sortThreads(s.threads.map((t) => (t.threadId === threadId ? fn(t) : t))) }))
  }
  const sending = new Set<ThreadId>()
  let ensuring: Promise<ThreadId> | undefined
  const summaryOf = (threadId: ThreadId) => get().threads.find((t) => t.threadId === threadId)
  const storeContext: StoreContext = { get, set, patchView, patchSummary, summaryOf }

  return {
    threads: [],
    localIds: [],
    openIds: [],
    activeThreadId: null,
    views: {},
    drafts: {},
    focusSeq: 0,
    hydrated: false,
    hydrating: false,
    hasMoreThreads: false,
    loadingMoreThreads: false,
    threadsOffset: 0,
    models: [],
    skills: [],
    collapsed: false,
    ...createThreadOps(storeContext),
    ...createConversationOps(storeContext),
    handleEvent: createEventHandler(storeContext),

    async hydrate() {
      if ((get().hydrated && !get().loadError) || get().hydrating) return
      set({ hydrating: true, loadError: undefined })
      try {
        const threads = sortThreads(await invoke('agent:listThreads', { channel: 'desktop', limit: THREAD_PAGE }))
        const first = threads[0]?.threadId ?? null
        const current = get()
        const merged = sortThreads([
          ...current.threads,
          ...threads.filter((t) => !current.threads.some((existing) => existing.threadId === t.threadId)),
        ])
        // The tabs open at the last quit come back (threadRestore.ts); otherwise the newest thread.
        const saved = current.openIds.length ? undefined : readSavedTabs()
        const restored = saved?.openIds.length ? saved : undefined
        const active = current.activeThreadId ?? restored?.activeThreadId ?? first
        set({
          threads: merged,
          hydrated: true,
          hydrating: false,
          hasMoreThreads: threads.length >= THREAD_PAGE,
          threadsOffset: threads.length,
          openIds: current.openIds.length ? current.openIds : (restored?.openIds ?? (first ? [first] : [])),
          activeThreadId: active,
        })
        const missing = (restored?.openIds ?? []).filter((id) => !merged.some((x) => x.threadId === id))
        if (active && !missing.includes(active) && !get().views[active]?.loaded) void get().loadThread(active)
        if (missing.length) void settleRestoredTabs(useAgentStore, missing)
        watchOpenTabs(useAgentStore)
      } catch (e) {
        set({ hydrating: false, hydrated: true, loadError: errorMessage(e) })
      }
      void get().loadModels()
      void get().loadSkills()
    },

    async loadThread(threadId) {
      if (get().localIds.includes(threadId)) return
      if (!get().views[threadId]) set((s) => ({ views: { ...s.views, [threadId]: createThreadView(threadId) } }))
      else patchView(threadId, (v) => ({ ...v, loaded: false, loadError: undefined }))
      try {
        const { summary, ...loaded } = await invoke('agent:getThread', { threadId })
        const merged = mergeLoadedView(threadId, loaded, get().views[threadId])
        set((s) => ({
          views: { ...s.views, [threadId]: merged },
          threads: sortThreads(
            s.threads.some((t) => t.threadId === threadId)
              ? s.threads.map((t) =>
                  t.threadId === threadId ? { ...t, ...summary, contextRef: summary.contextRef ?? t.contextRef } : t,
                )
              : [...s.threads, summary],
          ),
        }))
      } catch (e) {
        patchView(threadId, (v) => ({ ...v, loaded: true, loadError: errorMessage(e) }))
      }
    },

    async loadModels() {
      try {
        set({ models: await invoke('agent:listModels', undefined) })
      } catch {
        /* the model select shows an empty list with 管理模型… */
      }
    },

    async loadSkills() {
      try {
        set({ skills: await invoke('agent:listSkills', undefined) })
      } catch {
        /* '/' simply has nothing to offer */
      }
    },

    openThread(threadId, opts = {}) {
      const { openIds, views } = get()
      if (!openIds.includes(threadId)) set({ openIds: [...openIds, threadId] })
      if (opts.activate ?? true) set({ activeThreadId: threadId })
      if (!views[threadId]?.loaded) void get().loadThread(threadId)
    },

    closeThread(threadId) {
      const { openIds, activeThreadId } = get()
      const idx = openIds.indexOf(threadId)
      if (idx < 0) return
      const next = openIds.filter((id) => id !== threadId)
      let active = activeThreadId
      if (activeThreadId === threadId) active = next[Math.min(idx, next.length - 1)] ?? null
      set({ openIds: next, activeThreadId: active })
      if (get().localIds.includes(threadId)) {
        set((s) => {
          const views = { ...s.views }
          delete views[threadId]
          const drafts = { ...s.drafts }
          delete drafts[threadId]
          return {
            views,
            drafts,
            threads: s.threads.filter((t) => t.threadId !== threadId),
            localIds: s.localIds.filter((id) => id !== threadId),
          }
        })
      }
      // The panel collapses when its last tab closes; the Agent window has no strip to collapse and
      // instead opens a fresh thread (useAgentSurface's "always one open thread" rule).
      if (!next.length && !get().collapsed && useConfigStore.getState().config?.ui.shellMode !== 'agent')
        runCommand('agent.toggleCollapsed')
    },

    closeOtherThreads(threadId) {
      for (const id of get().openIds) if (id !== threadId) get().closeThread(id)
      get().setActive(threadId)
    },

    setActive(threadId) {
      if (!get().openIds.includes(threadId)) get().openThread(threadId)
      else set({ activeThreadId: threadId })
      get().requestFocus()
    },

    async createThread(opts = {}) {
      const threadId = newThreadId()
      const settings = await threadSettingsFromConfig()
      const now = Date.now()
      const contextRef = opts.contextRef
      const summary: ThreadSummary = {
        threadId,
        title: '',
        // The chip is stored with the thread (origin.contextRef), so it survives a restart.
        origin: { channel: 'desktop', ...(contextRef ? { contextRef } : {}) },
        settings,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        contextRef,
      }
      set((s) => ({
        threads: sortThreads([summary, ...s.threads]),
        openIds: [...s.openIds, threadId],
        activeThreadId: threadId,
        views: { ...s.views, [threadId]: createThreadView(threadId, { loaded: true }) },
        drafts: {
          ...s.drafts,
          [threadId]: contextRef ? { text: '', mentions: [mentionFromContextRef(contextRef)] } : emptyDraft(),
        },
        focusSeq: opts.focus === false ? s.focusSeq : s.focusSeq + 1,
      }))
      set((s) => ({ localIds: [...s.localIds, threadId] }))
      return threadId
    },

    async ensureActiveThread() {
      const active = get().activeThreadId
      if (active && get().openIds.includes(active)) return active
      ensuring ??= get()
        .createThread({ contextRef: activeTabContextRef() })
        .finally(() => {
          ensuring = undefined
        })
      return ensuring
    },

    async send(threadId, input) {
      const draft = input ?? get().drafts[threadId] ?? emptyDraft()
      const userInput = buildUserInput(draft.text, draft.mentions, draft.attachments)
      if (!userInput || sending.has(threadId)) return
      sending.add(threadId)
      const mode = sendModeFor(get().views[threadId])
      const clientInputId = newClientInputId()
      if (!input) set((s) => ({ drafts: { ...s.drafts, [threadId]: emptyDraft() } }))
      // Shown at once (as the turn's prompt, or as a steer waiting for the current step) until item.user records it.
      const pending = { clientInputId, ...userInput, mode, createdAt: Date.now() }
      patchView(threadId, (v) => addPendingInput(v, pending))
      try {
        if (get().localIds.includes(threadId)) {
          const summary = summaryOf(threadId)!
          await submit({ type: 'thread.create', threadId, origin: summary.origin, settings: summary.settings })
          set((s) => ({ localIds: s.localIds.filter((id) => id !== threadId) }))
        }
        patchSummary(threadId, (thread) => ({
          ...thread,
          title: isUntitledTitle(thread.title)
            ? draft.text.trim().replace(/\s+/g, ' ').slice(0, 24) ||
              draft.mentions[0]?.label ||
              t('agent.thread.attachmentTitle')
            : thread.title,
        }))
        await submit({ type: 'turn.start', threadId, input: userInput, mode, clientInputId })
        patchSummary(threadId, (t) => ({ ...t, updatedAt: Date.now() }))
      } catch (e) {
        patchView(threadId, (v) => ({ ...v, pendingInputs: withoutPendingInput(v.pendingInputs, clientInputId) }))
        set((s) => ({ drafts: { ...s.drafts, [threadId]: mergeRestoredDraft(s.drafts[threadId], draft) } }))
        toast.error(t('agent.toast.sendFailed', { detail: errorMessage(e) }))
      } finally {
        sending.delete(threadId)
      }
    },

    async sendDraft() {
      const { activeThreadId, openIds } = get()
      if (activeThreadId && openIds.includes(activeThreadId)) return get().send(activeThreadId)
      const scratch = get().drafts[SCRATCH_DRAFT_KEY] ?? emptyDraft()
      if (!buildUserInput(scratch.text, scratch.mentions, scratch.attachments)) return
      // createThread already toasts on failure; the scratch draft stays where it is
      const threadId = await get()
        .createThread({ contextRef: activeTabContextRef() })
        .catch(() => undefined)
      if (!threadId) return
      set((s) => {
        const seeded = s.drafts[threadId] ?? emptyDraft()
        const mentions = scratch.mentions.reduce((list, m) => addMention(list, m), seeded.mentions)
        return {
          drafts: {
            ...s.drafts,
            [threadId]: { text: scratch.text, mentions, attachments: scratch.attachments },
            [SCRATCH_DRAFT_KEY]: emptyDraft(),
          },
        }
      })
      await get().send(threadId)
    },

    async interrupt(threadId) {
      try {
        await submit({ type: 'turn.interrupt', threadId })
      } catch (e) {
        toast.error(t('agent.toast.stopFailed', { detail: errorMessage(e) }))
      }
    },

    async resolveApproval(threadId, approvalId, decision, extra) {
      // optimistic: the popover closes at once, the kernel's approval.resolved is then a no-op
      patchView(threadId, (v) => reduceEvent(v, { type: 'approval.resolved', threadId, approvalId, decision }))
      try {
        await submit({ type: 'approval.resolve', threadId, approvalId, decision, ...extra })
      } catch (e) {
        toast.error(t('agent.toast.approvalFailed', { detail: errorMessage(e) }))
      }
    },

    async updateSettings(threadId, patch) {
      patchSummary(threadId, (t) => ({ ...t, settings: { ...t.settings, ...patch } }))
      if (get().localIds.includes(threadId)) return
      try {
        await submit({ type: 'thread.settings', threadId, patch })
      } catch (e) {
        toast.error(t('agent.toast.settingsFailed', { detail: errorMessage(e) }))
      }
    },

    async compact(threadId, instructions) {
      if (get().localIds.includes(threadId)) return
      try {
        await submit({ type: 'thread.compact', threadId, ...(instructions ? { instructions } : {}) })
      } catch (e) {
        toast.error(t('agent.toast.compactFailed', { detail: errorMessage(e) }))
      }
    },

    async clearContext(threadId) {
      const previous = get().views[threadId]
      patchView(threadId, (v) => createThreadView(threadId, { loaded: true, usage: v.usage }))
      if (get().localIds.includes(threadId)) return
      try {
        await submit({ type: 'thread.clear', threadId })
        toast.success(t('agent.toast.cleared'))
      } catch (e) {
        if (previous) set((s) => ({ views: { ...s.views, [threadId]: previous } }))
        toast.error(t('agent.toast.clearFailed', { detail: errorMessage(e) }))
      }
    },

    setDraft(threadId, patch) {
      set((s) => ({ drafts: { ...s.drafts, [threadId]: { ...(s.drafts[threadId] ?? emptyDraft()), ...patch } } }))
    },

    addMentionToDraft(threadId, mention) {
      set((s) => {
        const draft = s.drafts[threadId] ?? emptyDraft()
        return { drafts: { ...s.drafts, [threadId]: { ...draft, mentions: addMention(draft.mentions, mention) } } }
      })
    },

    requestFocus() {
      set((s) => ({ focusSeq: s.focusSeq + 1 }))
    },

    setCollapsed(collapsed) {
      if (get().collapsed === collapsed) return
      set({ collapsed })
      if (!collapsed) {
        useShellStore.getState().setAgentUnread(false)
        get().requestFocus()
      }
    },

    async quote(payload) {
      const threadId = await get().ensureActiveThread()
      // The ids go to the kernel with the turn: the host injects those messages' text (prompts/mentionFragments).
      const messageIds = payload.messageIds?.slice(0, MAX_QUOTED_MESSAGES)
      const { kind, id, label } = payload
      get().addMentionToDraft(threadId, { kind, id, label, ...(messageIds?.length ? { messageIds } : {}) })
      get().requestFocus()
    },

    async newThread(payload = {}) {
      const contextRef = payload.contextRef ?? activeTabContextRef()
      const threadId = await get().createThread({ contextRef, focus: true })
      if (get().collapsed) runCommand('agent.toggleCollapsed')
      return threadId
    },
  }
})

/** Reset module state (tests). */
export function __resetAgentStoreForTests(): void {
  unsubscribe?.()
  unsubscribe = undefined
  subscribed = false
  clearSavedTabs()
  useAgentStore.setState({
    ...conversationInitialState,
    threads: [],
    localIds: [],
    openIds: [],
    activeThreadId: null,
    views: {},
    drafts: {},
    focusSeq: 0,
    hydrated: false,
    hydrating: false,
    loadError: undefined,
    hasMoreThreads: false,
    loadingMoreThreads: false,
    threadsOffset: 0,
    models: [],
    skills: [],
    collapsed: false,
  })
}
