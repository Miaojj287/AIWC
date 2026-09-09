/**
 * Agent panel state (zustand). Threads come from agent:listThreads / agent:getThread; live changes
 * arrive on the single 'agent:event' subscription and are folded by reducer.ts. Everything that
 * talks to the kernel goes through `agent:submit` with a protocol Op — there is no other path.
 */
import { create } from 'zustand'
import {
  newThreadId,
  type ApprovalDecision,
  type ApprovalId,
  type Event,
  type InvokeRes,
  type Mention,
  type Op,
  type SkillSummary,
  type ThreadId,
  type ThreadSettings,
  type ThreadSummary,
} from '@aiwc/protocol'
import { toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { getBridge } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { useShellStore } from '@/shell/shellStore'
import { activeTabContextRef, mentionFromContextRef, type ContextRef } from './contextRef'
import { addMention, buildUserInput } from './mentions'
import { createThreadView, emptyDraft, SCRATCH_DRAFT_KEY, usageRatio, USAGE_WARN_RATIO, type ComposerDraft, type ThreadViewState } from './model'
import { findUserInput, reduceEvent, viewFromHistory } from './reducer'

export type ModelOption = InvokeRes<'agent:listModels'>[number]

export interface AgentState {
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
  models: ModelOption[]
  skills: SkillSummary[]
  /** Mirrors the panel's collapsed prop so events can raise the unread dot. */
  collapsed: boolean

  hydrate(): Promise<void>
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
  /** 重试 / 重新生成: resubmit the user input of a turn. */
  retryTurn(threadId: ThreadId, turnId?: string): Promise<void>
  interrupt(threadId: ThreadId): Promise<void>
  resolveApproval(threadId: ThreadId, approvalId: ApprovalId, decision: ApprovalDecision): Promise<void>
  updateSettings(threadId: ThreadId, patch: Partial<ThreadSettings>): Promise<void>
  compact(threadId: ThreadId): Promise<void>
  clearContext(threadId: ThreadId): Promise<void>
  rename(threadId: ThreadId, title: string): Promise<void>
  pin(threadId: ThreadId, pinned: boolean): Promise<void>
  remove(threadId: ThreadId): Promise<void>
  exportThread(threadId: ThreadId): Promise<void>
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

const sortThreads = (list: ThreadSummary[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

const submit = (op: Op) => invoke('agent:submit', op)

async function threadSettingsFromConfig(): Promise<ThreadSettings> {
  const store = useConfigStore.getState()
  const config = store.config ?? (await store.hydrate().catch(() => undefined))
  return {
    permissionMode: config?.agent.permissionMode ?? 'ask',
    allowAlways: [...(config?.agent.allowAlways ?? [])],
    profile: 'desktop-chat',
    model: config?.ai.defaultModel,
  }
}

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

  async function fetchSuggestions(threadId: ThreadId) {
    const ref = summaryOf(threadId)?.contextRef
    try {
      const suggestions = await invoke('agent:suggestPrompts', { contextRef: ref })
      patchView(threadId, (v) => (v.items.length === 0 ? { ...v, suggestions } : v))
    } catch {
      /* suggestions are optional */
    }
  }

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
    models: [],
    skills: [],
    collapsed: false,

    async hydrate() {
      if ((get().hydrated && !get().loadError) || get().hydrating) return
      set({ hydrating: true, loadError: undefined })
      try {
        const threads = sortThreads(await invoke('agent:listThreads', { channel: 'desktop', limit: 50 }))
        const first = threads[0]?.threadId ?? null
        const current = get()
        const merged = sortThreads([...current.threads, ...threads.filter((t) => !current.threads.some((existing) => existing.threadId === t.threadId))])
        const active = current.activeThreadId ?? first
        set({ threads: merged, hydrated: true, hydrating: false, openIds: current.openIds.length ? current.openIds : first ? [first] : [], activeThreadId: active })
        if (active && !get().views[active]?.loaded) void get().loadThread(active)
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
        const { summary, items } = await invoke('agent:getThread', { threadId })
        const live = get().views[threadId]
        const view = viewFromHistory(threadId, items)
        // keep live-only state that may have arrived while loading
        const merged: ThreadViewState = live
          ? { ...view, usage: live.usage ?? view.usage, isStreaming: live.isStreaming, currentTurnId: live.currentTurnId, turnStartedAt: live.turnStartedAt, pendingApprovals: live.pendingApprovals }
          : view
        set((s) => ({
          views: { ...s.views, [threadId]: merged },
          threads: sortThreads(
            s.threads.some((t) => t.threadId === threadId)
              ? s.threads.map((t) => (t.threadId === threadId ? { ...t, ...summary, contextRef: summary.contextRef ?? t.contextRef } : t))
              : [...s.threads, summary],
          ),
        }))
        if (merged.items.length === 0) void fetchSuggestions(threadId)
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
          const views = { ...s.views }; delete views[threadId]
          const drafts = { ...s.drafts }; delete drafts[threadId]
          return { views, drafts, threads: s.threads.filter((t) => t.threadId !== threadId), localIds: s.localIds.filter((id) => id !== threadId) }
        })
      }
      if (!next.length && !get().collapsed) runCommand('agent.toggleCollapsed')
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
      const summary: ThreadSummary = { threadId, title: '新会话', origin: { channel: 'desktop' }, settings, createdAt: now, updatedAt: now, pinned: false, contextRef }
      set((s) => ({
        threads: sortThreads([summary, ...s.threads]),
        openIds: [...s.openIds, threadId],
        activeThreadId: threadId,
        views: { ...s.views, [threadId]: createThreadView(threadId, { loaded: true }) },
        drafts: { ...s.drafts, [threadId]: contextRef ? { text: '', mentions: [mentionFromContextRef(contextRef)] } : emptyDraft() },
        focusSeq: opts.focus === false ? s.focusSeq : s.focusSeq + 1,
      }))
      set((s) => ({ localIds: [...s.localIds, threadId] }))
      void fetchSuggestions(threadId)
      return threadId
    },

    async ensureActiveThread() {
      const active = get().activeThreadId
      if (active && get().openIds.includes(active)) return active
      ensuring ??= get().createThread({ contextRef: activeTabContextRef() }).finally(() => { ensuring = undefined })
      return ensuring
    },

    async send(threadId, input) {
      const draft = input ?? get().drafts[threadId] ?? emptyDraft()
      const userInput = buildUserInput(draft.text, draft.mentions)
      if (!userInput || sending.has(threadId)) return
      sending.add(threadId)
      const view = get().views[threadId]
      if (!input) set((s) => ({ drafts: { ...s.drafts, [threadId]: emptyDraft() } }))
      patchView(threadId, (v) => ({ ...v, suggestions: undefined }))
      try {
        if (get().localIds.includes(threadId)) {
          const summary = summaryOf(threadId)!
          await submit({ type: 'thread.create', threadId, origin: summary.origin, settings: summary.settings })
          set((s) => ({ localIds: s.localIds.filter((id) => id !== threadId) }))
        }
        patchSummary(threadId, (t) => ({ ...t, title: !t.title || t.title === '新会话' ? draft.text.trim().replace(/\s+/g, ' ').slice(0, 24) || draft.mentions[0]?.label || '附件会话' : t.title }))
        await submit({ type: 'turn.start', threadId, input: userInput, mode: view?.isStreaming ? 'steer' : 'start' })
        patchSummary(threadId, (t) => ({ ...t, updatedAt: Date.now() }))
      } catch (e) {
        set((s) => {
          const current = s.drafts[threadId] ?? emptyDraft()
          const mentions = current.mentions.reduce((list, mention) => addMention(list, mention), draft.mentions)
          return { drafts: { ...s.drafts, [threadId]: { text: current.text ? [draft.text, current.text].filter(Boolean).join('\n\n') : draft.text, mentions } } }
        })
        toast.error(`发送失败：${errorMessage(e)}`)
      } finally {
        sending.delete(threadId)
      }
    },

    async sendDraft() {
      const { activeThreadId, openIds } = get()
      if (activeThreadId && openIds.includes(activeThreadId)) return get().send(activeThreadId)
      const scratch = get().drafts[SCRATCH_DRAFT_KEY] ?? emptyDraft()
      if (!buildUserInput(scratch.text, scratch.mentions)) return
      // createThread already toasts on failure; the scratch draft stays where it is
      const threadId = await get().createThread({ contextRef: activeTabContextRef() }).catch(() => undefined)
      if (!threadId) return
      set((s) => {
        const seeded = s.drafts[threadId] ?? emptyDraft()
        const mentions = scratch.mentions.reduce((list, m) => addMention(list, m), seeded.mentions)
        return { drafts: { ...s.drafts, [threadId]: { text: scratch.text, mentions }, [SCRATCH_DRAFT_KEY]: emptyDraft() } }
      })
      await get().send(threadId)
    },

    async retryTurn(threadId, turnId) {
      const view = get().views[threadId]
      const user = view ? findUserInput(view.items, turnId as never) ?? findUserInput(view.items) : undefined
      if (!user) return
      const text = user.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
      await get().send(threadId, { text, mentions: user.mentions })
    },

    async interrupt(threadId) {
      try {
        await submit({ type: 'turn.interrupt', threadId })
      } catch (e) {
        toast.error(`停止失败：${errorMessage(e)}`)
      }
    },

    async resolveApproval(threadId, approvalId, decision) {
      // optimistic: the popover closes at once, the kernel's approval.resolved is then a no-op
      patchView(threadId, (v) => reduceEvent(v, { type: 'approval.resolved', threadId, approvalId, decision }))
      try {
        await submit({ type: 'approval.resolve', threadId, approvalId, decision })
      } catch (e) {
        toast.error(`提交确认失败：${errorMessage(e)}`)
      }
    },

    async updateSettings(threadId, patch) {
      patchSummary(threadId, (t) => ({ ...t, settings: { ...t.settings, ...patch } }))
      if (get().localIds.includes(threadId)) return
      try {
        await submit({ type: 'thread.settings', threadId, patch })
      } catch (e) {
        toast.error(`更新会话设置失败：${errorMessage(e)}`)
      }
    },

    async compact(threadId) {
      if (get().localIds.includes(threadId)) return
      try {
        await submit({ type: 'thread.compact', threadId })
      } catch (e) {
        toast.error(`压缩失败：${errorMessage(e)}`)
      }
    },

    async clearContext(threadId) {
      const previous = get().views[threadId]
      patchView(threadId, (v) => createThreadView(threadId, { loaded: true, usage: v.usage }))
      if (get().localIds.includes(threadId)) { void fetchSuggestions(threadId); return }
      try {
        await submit({ type: 'thread.clear', threadId })
        toast.success('已清空上下文')
        void fetchSuggestions(threadId)
      } catch (e) {
        if (previous) set((s) => ({ views: { ...s.views, [threadId]: previous } }))
        toast.error(`清空失败：${errorMessage(e)}`)
      }
    },

    async rename(threadId, title) {
      const trimmed = title.trim()
      if (!trimmed) return
      const before = summaryOf(threadId)?.title
      patchSummary(threadId, (t) => ({ ...t, title: trimmed }))
      if (get().localIds.includes(threadId)) {
        patchSummary(threadId, (t) => ({ ...t, settings: { ...t.settings, title: trimmed } }))
        return
      }
      try {
        await invoke('agent:renameThread', { threadId, title: trimmed })
      } catch (e) {
        if (before !== undefined) patchSummary(threadId, (t) => ({ ...t, title: before }))
        toast.error(`重命名失败：${errorMessage(e)}`)
      }
    },

    async pin(threadId, pinned) {
      patchSummary(threadId, (t) => ({ ...t, pinned }))
      if (get().localIds.includes(threadId)) return
      try {
        await invoke('agent:pinThread', { threadId, pinned })
      } catch (e) {
        patchSummary(threadId, (t) => ({ ...t, pinned: !pinned }))
        toast.error(`操作失败：${errorMessage(e)}`)
      }
    },

    async remove(threadId) {
      if (get().localIds.includes(threadId)) { get().closeThread(threadId); return }
      try {
        await invoke('agent:deleteThread', { threadId })
      } catch (e) {
        toast.error(`删除失败：${errorMessage(e)}`)
        return
      }
      get().closeThread(threadId)
      set((s) => {
        const views = { ...s.views }
        const drafts = { ...s.drafts }
        delete views[threadId]
        delete drafts[threadId]
        return { threads: s.threads.filter((t) => t.threadId !== threadId), views, drafts }
      })
      toast.success('会话已删除')
    },

    async exportThread(threadId) {
      try {
        const { path } = await invoke('agent:exportThread', { threadId })
        toast.success('对话已导出', { detail: path, action: { label: '打开位置', onClick: () => void invoke('file:reveal', { path }) } })
      } catch (e) {
        toast.error(`导出失败：${errorMessage(e)}`)
      }
    },

    async loadCompactionSummary(threadId, itemId) {
      const view = get().views[threadId]
      const known = view?.items.find((it) => it.kind === 'compaction' && (it.id === itemId || it.summaryItemId === itemId))
      if (known?.kind === 'compaction' && known.summary) return known.summary
      try {
        const { items } = await invoke('agent:getThread', { threadId })
        const found = items.find((h) => h.type === 'compaction_summary' && h.id === itemId)
        const summary = found?.type === 'compaction_summary' ? found.summary : undefined
        if (summary) patchView(threadId, (v) => ({ ...v, items: v.items.map((it) => (it.kind === 'compaction' && it.summaryItemId === itemId ? { ...it, summary } : it)) }))
        return summary
      } catch {
        return undefined
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

    handleEvent(e) {
      const { threadId } = e
      switch (e.type) {
        case 'thread.created': {
          if (e.origin.channel !== 'desktop' || summaryOf(threadId)) return
          const now = Date.now()
          set((s) => ({ threads: sortThreads([{ threadId, title: e.settings.title ?? '新会话', origin: e.origin, settings: e.settings, createdAt: now, updatedAt: now, pinned: false }, ...s.threads]) }))
          return
        }
        case 'thread.settings':
          patchSummary(threadId, (t) => ({ ...t, settings: e.settings }))
          return
        case 'thread.title':
          patchSummary(threadId, (t) => ({ ...t, title: e.title }))
          return
        case 'memory.written':
          toast.success(`Agent 写入了 ${e.count} 条记忆到 ${e.file}${e.file.endsWith('.md') ? '' : '.md'}`, {
            action: { label: '查看', onClick: () => runCommand('tab.openSettings', { page: 'memory' }) },
          })
          return
        default:
          break
      }

      const view = get().views[threadId]
      if (!view) return
      const next = reduceEvent(view, e)
      if (next !== view) set((s) => ({ views: { ...s.views, [threadId]: next } }))

      if (e.type === 'turn.completed' || e.type === 'item.user') patchSummary(threadId, (t) => ({ ...t, updatedAt: Date.now() }))

      // side effects decided from the event, never from inside the reducer
      if (e.type === 'tool.call' && e.status === 'done' && e.artifacts?.length && view.loaded) {
        for (const a of e.artifacts) if (a.kind === 'file' && a.path) runCommand('tab.openFile', { path: a.path, title: a.title })
      }
      if (e.type === 'context.usage' && usageRatio(e.usage) >= USAGE_WARN_RATIO && !view.usageWarned) {
        patchView(threadId, (v) => ({ ...v, usageWarned: true }))
        toast.warning(`上下文占用已达 ${Math.round(usageRatio(e.usage) * 100)}%，建议压缩`, {
          action: { label: '压缩上下文', onClick: () => void get().compact(threadId) },
        })
      }
      if (get().collapsed && (e.type === 'text.end' || e.type === 'turn.completed' || e.type === 'approval.requested' || e.type === 'error')) {
        useShellStore.getState().setAgentUnread(true)
      }
    },

    async quote(payload) {
      const threadId = await get().ensureActiveThread()
      const label = payload.messageIds?.length ? `${payload.label} · ${payload.messageIds.length} 条` : payload.label
      get().addMentionToDraft(threadId, { kind: payload.kind, id: payload.id, label })
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

/** Selector helpers. */
export const selectActiveView = (s: AgentState): ThreadViewState | undefined => (s.activeThreadId ? s.views[s.activeThreadId] : undefined)
export const selectActiveSummary = (s: AgentState): ThreadSummary | undefined => s.threads.find((t) => t.threadId === s.activeThreadId)
export const selectOpenThreads = (s: AgentState): ThreadSummary[] => s.openIds.map((id) => s.threads.find((t) => t.threadId === id)).filter((t): t is ThreadSummary => Boolean(t))

/** Reset module state (tests). */
export function __resetAgentStoreForTests(): void {
  unsubscribe?.()
  unsubscribe = undefined
  subscribed = false
  useAgentStore.setState({
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
    models: [],
    skills: [],
    collapsed: false,
  })
}
