/**
 * Auto-reply service: turns a gated inbound event into a reply draft, counts down, and sends it
 * unless the user cancels it or a newer message in the same chat supersedes it (ARCHITECTURE §7).
 *
 * A rule has exactly one behaviour — reply automatically. There is no per-rule "confirm first"
 * escape hatch: the countdown IS the confirmation window, and it is visible while it runs. Drafts
 * in 'confirm'/'suggest' mode still exist, but only for things the user asked for by hand (the
 * Agent's draft_reply handoff, a manual retry from the reply desk).
 *
 * Every decision is written to the record store; the halt latch stops everything until resume().
 */
import { nanoid } from 'nanoid'
import type {
  AutoReplyRecord,
  AutoReplyRule,
  ChannelKind,
  GatewayEvent,
  MessageEvent,
  ReplyDecision,
  ReplyDraft,
  SendResult,
  SessionKey,
} from '@aiwc/protocol'
import { createEmitter, errorMessage } from '../core/emitter'
import type { Gateway } from '../core/gateway'
import { splitExplicitBubbles } from '../adapters/ilink/textSplit'
import type { AutoReplyRecordStore } from './recordStore'
import { substituteTemplate, templateVars } from './template'

export interface HandleOptions {
  /** Show the draft for confirmation instead of counting down (reply-desk retry). */
  manualRetry?: boolean
  /** Ignore the "already attempted this message" latch. */
  force?: boolean
}

export interface GenerateContext {
  sessionKey: SessionKey
  decision: ReplyDecision
  signal?: AbortSignal
}

export interface AutoReplyServiceDeps {
  gateway: Pick<Gateway, 'onInbound' | 'outbound'> & { emit?: (e: GatewayEvent) => void }
  records: AutoReplyRecordStore
  countdownMs: () => number
  queueGapMs?: () => number
  onDraft: (draft: ReplyDraft) => void
  /** Model call for rules with source 'ai'. Receives the gated event and the rule. */
  generate: (event: MessageEvent, rule: AutoReplyRule, ctx: GenerateContext) => Promise<string | { text: string; suggestions?: string[] }>
  onRecord?: (record: AutoReplyRecord) => void
  /** Resolve {昵称} / {群名} when the adapter did not supply display names. */
  resolveNames?: (event: MessageEvent) => Promise<{ nickname?: string; groupName?: string }>
  canSend?: (draft: ReplyDraft) => string | undefined | Promise<string | undefined>
  supportsRecall?: (channel: ChannelKind) => boolean
  now?: () => number
  /** Countdown tick interval. */
  tickMs?: number
  /** Pending confirm/suggest drafts expire after this long. */
  draftTtlMs?: number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface AutoReplyService {
  /**
   * Subscribe to gateway inbound and restore persisted drafts: pending confirm/suggest drafts re-enter
   * the live queue (resolvable again), stale auto drafts expire. Idempotent.
   */
  start(): void
  stop(): Promise<void>
  /**
   * Handle an already-gated inbound directly (hosts that drive the gateway themselves).
   * `force` re-attempts a trigger this service has already seen — the manual "trigger once" button.
   */
  handle(event: MessageEvent, decision: ReplyDecision, sessionKey: SessionKey, opts?: HandleOptions): Promise<void>
  /**
   * Put an externally created pending draft (draft_reply handoff, host-side compose) into the live
   * queue right away — persisted to the record store (source of truth) and resolvable / cancellable
   * like any auto-reply draft. Auto-mode drafts start their countdown; no-op when already queued.
   */
  enqueueDraft(draft: ReplyDraft): void
  listGenerating(): Array<{ sessionId: string; name: string }>
  listDrafts(): ReplyDraft[]
  resolveDraft(draftId: string, decision: 'approve' | 'reject' | 'edit', text?: string): Promise<void>
  /** Cancel a pending countdown / confirmation. */
  invalidate(sessionId: string, reason: string): void
  hold(draftId: string): void
  retry(draftId: string): Promise<void>
  cancel(draftId: string): void
  halt(reason: string): void
  resume(): void
  readonly halted: boolean
  readonly haltReason: string | undefined
  recall(recordId: string): Promise<{ ok: boolean; error?: string }>
  events: { on(listener: (e: GatewayEvent) => void): () => void }
}

export const RECALL_WINDOW_MS = 2 * 60_000
const DEFAULT_TICK_MS = 1000
const DEFAULT_DRAFT_TTL_MS = 30 * 60_000

export function createAutoReplyService(deps: AutoReplyServiceDeps): AutoReplyService {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const tickMs = deps.tickMs ?? DEFAULT_TICK_MS
  const draftTtl = deps.draftTtlMs ?? DEFAULT_DRAFT_TTL_MS
  const supportsRecall = deps.supportsRecall ?? (() => false)

  const events = createEmitter<GatewayEvent>()
  const emit = (e: GatewayEvent): void => {
    events.emit(e)
    deps.gateway.emit?.(e)
  }

  // The draft carries its own target (draft.source); recordId is absent for drafts without an audit
  // record of their own (handoffs — the gateway 'outbound' event still audits the send).
  type Live = { draft: ReplyDraft; contextToken?: string; recordId?: string; triggerKey?: string; timer?: ReturnType<typeof setTimeout> }
  const live = new Map<string, Live>()
  const bySession = new Map<string, string>()
  /**
   * Messages we have already attempted, so a re-delivery of the same inbound does not reply twice.
   *
   * An ATTEMPT that ends without a sent reply releases its key again: the peer still has the last
   * word, so as far as the user is concerned the message is still unanswered and the next
   * activation (re-enable / restart / "立即触发一次") must be allowed to try it again. Leaving the
   * key latched is what made a single "Insufficient Balance" permanently freeze that chat.
   */
  const seenTriggers = new Set<string>()
  const releaseTrigger = (key: string | undefined): void => {
    if (key) seenTriggers.delete(key)
  }
  const generatingNames = new Map<string, string>()
  const generations = new Map<string, AbortController>()
  let stopped = false
  const pendingGenerations = new Set<Promise<void>>()
  let halted = false
  let haltReason: string | undefined
  let unsubscribe: (() => void) | undefined

  // ── persistence helpers ──────────────────────────────────────────────────────────────────────
  const persistDraft = (draft: ReplyDraft): void => {
    deps.records.saveDraft(draft)
    deps.onDraft(draft)
  }
  const updateDraft = (entry: Live, patch: Partial<ReplyDraft>): ReplyDraft => {
    entry.draft = { ...entry.draft, ...patch }
    persistDraft(entry.draft)
    return entry.draft
  }
  const updateRecord = (id: string | undefined, patch: Partial<Omit<AutoReplyRecord, 'id'>>): void => {
    if (!id) return
    const rec = deps.records.updateRecord(id, patch)
    if (rec) deps.onRecord?.(rec)
  }
  const clearTimer = (entry: Live): void => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
  }
  const finish = (entry: Live): void => {
    clearTimer(entry)
    live.delete(entry.draft.id)
    if (bySession.get(entry.draft.source.chatId) === entry.draft.id) bySession.delete(entry.draft.source.chatId)
  }
  /** Register a pending draft as the live (latest) draft of its chat. Does not persist. */
  const track = (draft: ReplyDraft, extra: Omit<Live, 'draft' | 'timer'> = {}): Live => {
    const entry: Live = { draft, ...extra }
    live.set(draft.id, entry)
    bySession.set(draft.source.chatId, draft.id)
    return entry
  }

  // ── send ─────────────────────────────────────────────────────────────────────────────────────
  let sendChain = Promise.resolve()
  let lastSentAt = 0
  function send(entry: Live, text: string): Promise<void> {
    const job = sendChain.then(async () => {
      const wait = lastSentAt ? Math.max(0, lastSentAt + (deps.queueGapMs?.() ?? 0) - now()) : 0
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      await processSend(entry, text)
      if (entry.draft.state === 'sent') lastSentAt = now()
    })
    sendChain = job.catch((error) => log('error', 'auto-reply send failed', errorMessage(error)))
    return job
  }
  async function processSend(entry: Live, text: string): Promise<void> {
    if (!live.has(entry.draft.id)) return
    let blocked: string | undefined
    try { blocked = halted ? haltReason ?? '已熔断' : await deps.canSend?.(entry.draft) }
    catch (error) { blocked = errorMessage(error) }
    if (blocked) {
      updateDraft(entry, { state: 'failed', error: blocked })
      updateRecord(entry.recordId, { status: 'failed', error: blocked })
      releaseTrigger(entry.triggerKey)
      finish(entry)
      return
    }
    if (!live.has(entry.draft.id) || !['pending', 'approved'].includes(entry.draft.state)) return
    clearTimer(entry)
    updateDraft(entry, { state: 'sending', draft: text })
    let result: SendResult
    try {
      result = await deps.gateway.outbound.send({
        to: entry.draft.source,
        parts: splitExplicitBubbles(text).map((t) => ({ type: 'text' as const, text: t })),
        contextToken: entry.contextToken,
        expectedAccountId: entry.draft.accountId,
        ruleId: entry.draft.ruleId,
        reason: 'auto_reply',
      })
    } catch (err) {
      result = { ok: false, error: errorMessage(err) }
    }
    const at = now()
    if (result.ok) {
      updateDraft(entry, { state: 'sent' })
      updateRecord(entry.recordId, {
        status: 'sent',
        replyText: text,
        at,
        recallableUntil: supportsRecall(entry.draft.source.channel) ? at + RECALL_WINDOW_MS : undefined,
      })
    } else {
      updateDraft(entry, { state: 'failed', error: result.error })
      updateRecord(entry.recordId, { status: 'failed', replyText: text, error: result.error })
      releaseTrigger(entry.triggerKey)
      // A verified channel (UI injection) that failed its read-back already halted itself: mirror it.
      if (result.verified === false) service.halt(result.error ?? '发送校验失败')
    }
    finish(entry)
  }

  // ── countdown ────────────────────────────────────────────────────────────────────────────────
  function scheduleCountdown(entry: Live): void {
    const endsAt = entry.draft.countdownEndsAt ?? now()
    const tick = (): void => {
      const remaining = Math.max(0, endsAt - now())
      emit({ type: 'autoreply.countdown', draftId: entry.draft.id, remainingMs: remaining })
      if (remaining <= 0) {
        entry.timer = undefined
        void send(entry, entry.draft.draft).catch((error) => log('error', 'auto send failed', errorMessage(error)))
        return
      }
      entry.timer = setTimeout(tick, Math.min(tickMs, remaining))
    }
    tick()
  }

  function supersede(chatId: string, reason: string): void {
    const previousId = bySession.get(chatId)
    if (!previousId) return
    const prev = live.get(previousId)
    if (!prev) return
    if (prev.draft.state === 'sending') return
    if (prev.draft.state === 'pending' || prev.draft.state === 'approved') {
      updateDraft(prev, { state: 'expired', error: reason })
      updateRecord(prev.recordId, { status: 'rejected', error: reason })
    }
    releaseTrigger(prev.triggerKey)
    finish(prev)
  }

  const finishGeneration = (sessionId: string) => {
    generations.delete(sessionId)
    const name = generatingNames.get(sessionId)
    if (name) { generatingNames.delete(sessionId); emit({ type: 'autoreply.generating', sessionId, name, active: false }) }
  }

  // ── inbound ──────────────────────────────────────────────────────────────────────────────────
  function handle(event: MessageEvent, decision: ReplyDecision, sessionKey: SessionKey, opts: HandleOptions = {}): Promise<void> {
    const task = generateDraft(event, decision, sessionKey, opts)
    pendingGenerations.add(task)
    void task.then(() => pendingGenerations.delete(task), () => pendingGenerations.delete(task))
    return task
  }
  async function generateDraft(event: MessageEvent, decision: ReplyDecision, sessionKey: SessionKey, opts: HandleOptions): Promise<void> {
    if (!decision.reply || halted || stopped) return
    const rule = deps.records.getRule(event.source.chatId)
    if (!rule || !rule.enabled) return
    const triggerKey = `${event.source.channel}:${event.id}`
    if (seenTriggers.has(triggerKey) && !opts.force) return
    seenTriggers.add(triggerKey)
    if (seenTriggers.size > 2000) seenTriggers.delete(seenTriggers.values().next().value!)

    // A manual retry from the reply desk is the user asking to look at it first; everything the
    // monitor brings in is an auto-reply, because that is the only thing a rule can be.
    const effective: ReplyDraft['mode'] = opts.manualRetry ? 'confirm' : 'auto'

    // A newer message from the same chat makes any pending draft stale — real people answer the latest one.
    service.invalidate(event.source.chatId, '被同一会话的新消息取代')
    const controller = new AbortController()
    generations.set(event.source.chatId, controller)
    if (rule.source === 'ai') {
      generatingNames.set(event.source.chatId, event.source.displayName ?? event.source.chatId)
      emit({ type: 'autoreply.generating', sessionId: event.source.chatId, name: event.source.displayName ?? event.source.chatId, active: true })
    }

    const recordId = `rec_${nanoid(10)}`
    const record: AutoReplyRecord = {
      id: recordId,
      ruleId: rule.id,
      sessionId: event.source.chatId,
      triggerMessage: { id: event.id, text: event.text, senderName: (event.raw as { senderName?: string } | undefined)?.senderName ?? event.source.displayName, at: event.timestamp },
      replyText: '',
      at: now(),
      status: 'pending',
    }
    deps.records.addRecord(record)
    deps.onRecord?.(record)

    let text: string
    let suggestions: string[] | undefined
    try {
      if (rule.source === 'fixed') {
        const names = deps.resolveNames ? await deps.resolveNames(event) : {}
        text = substituteTemplate(rule.fixedText ?? '', templateVars(event, names, now()))
      } else {
        const result = await deps.generate(event, rule, { sessionKey, decision, signal: controller.signal })
        text = typeof result === 'string' ? result : result.text
        suggestions = typeof result === 'string' ? undefined : result.suggestions
      }
    } catch (err) {
      if (controller.signal.aborted) { releaseTrigger(triggerKey); updateRecord(recordId, { status: 'rejected', error: '生成已取消' }); return }
      finishGeneration(event.source.chatId)
      releaseTrigger(triggerKey)
      const error = errorMessage(err)
      log('warn', 'auto-reply generation failed', error)
      updateRecord(recordId, { status: 'failed', error })
      const failed: ReplyDraft = {
        id: `drf_${nanoid(10)}`,
        ruleId: rule.id,
        source: event.source,
        triggerMessageId: event.id,
        triggerText: event.text,
        draft: '',
        recordId,
        contextToken: (event.raw as { context_token?: string } | undefined)?.context_token,
        accountId: (event.raw as { accountId?: string } | undefined)?.accountId,
        state: 'failed',
        createdAt: now(),
        mode: effective,
        error,
      }
      persistDraft(failed)
      return
    }
    if (controller.signal.aborted) { releaseTrigger(triggerKey); updateRecord(recordId, { status: 'rejected', error: '生成已取消' }); return }
    finishGeneration(event.source.chatId)
    text = text.trim()
    if (!text) {
      releaseTrigger(triggerKey)
      updateRecord(recordId, { status: 'failed', error: '回复内容为空' })
      return
    }

    const createdAt = now()
    const draft: ReplyDraft = {
      id: `drf_${nanoid(10)}`,
      ruleId: rule.id,
      source: event.source,
      triggerMessageId: event.id,
      triggerText: event.text,
      draft: text,
      suggestions,
      recordId,
      accountId: (event.raw as { accountId?: string } | undefined)?.accountId,
      contextToken: (event.raw as { context_token?: string } | undefined)?.context_token,
      state: 'pending',
      createdAt,
      expiresAt: effective === 'auto' ? undefined : createdAt + draftTtl,
      mode: effective,
      countdownEndsAt: effective === 'auto' ? createdAt + Math.max(0, deps.countdownMs()) : undefined,
    }
    const raw = event.raw as { context_token?: string } | undefined
    const entry = track(draft, { contextToken: raw?.context_token, recordId, triggerKey })
    persistDraft(draft)
    updateRecord(recordId, { replyText: text })
    emit({ type: 'autoreply.queued', draftId: draft.id })

    if (effective === 'auto') scheduleCountdown(entry)
  }

  function enqueueDraft(draft: ReplyDraft): void {
    if (draft.state !== 'pending') throw new Error(`只能加入待处理的草稿（当前状态 ${draft.state}）`)
    if (live.has(draft.id)) return
    const next: ReplyDraft =
      draft.mode === 'auto' && draft.countdownEndsAt === undefined ? { ...draft, countdownEndsAt: now() + Math.max(0, deps.countdownMs()) } : { ...draft }
    if (halted && next.mode === 'auto') {
      // Same fate halt() gives pending auto drafts: never let one fire while the latch is closed.
      persistDraft({ ...next, state: 'expired', error: `已熔断：${haltReason ?? '已熔断'}` })
      return
    }
    supersede(next.source.chatId, '被同一会话的新草稿取代')
    const entry = track(next)
    persistDraft(entry.draft)
    emit({ type: 'autoreply.queued', draftId: entry.draft.id })
    if (entry.draft.mode === 'auto') scheduleCountdown(entry)
  }

  // ── public api ───────────────────────────────────────────────────────────────────────────────
  const service: AutoReplyService = {
    start() {
      if (unsubscribe) return
      stopped = false
      unsubscribe = deps.gateway.onInbound((event, decision, key) => { void handle(event, decision, key).catch((error) => log('error', 'auto-reply inbound failed', errorMessage(error))) })
      // Restore, oldest first so the newest draft of a chat ends up as its live one: confirm/suggest
      // drafts re-enter the queue; stale auto drafts must never fire after a restart.
      for (const draft of deps.records.listDrafts(['pending']).reverse()) {
        if (draft.mode === 'auto') {
          persistDraft({ ...draft, state: 'expired', error: '应用重启，未自动发送' })
          updateRecord(draft.recordId, { status: 'rejected', error: '应用重启，未自动发送' })
        }
        else if (!live.has(draft.id)) {
          supersede(draft.source.chatId, '被较新的草稿取代')
          track(draft, { recordId: draft.recordId, contextToken: draft.contextToken })
        }
      }
    },
    async stop() {
      stopped = true
      unsubscribe?.()
      unsubscribe = undefined
      for (const controller of generations.values()) controller.abort()
      for (const id of [...generations.keys()]) finishGeneration(id)
      for (const entry of [...live.values()]) {
        if (entry.draft.state === 'sending') continue
        if (entry.draft.mode === 'auto') {
          updateDraft(entry, { state: 'expired', error: '应用已停止，未自动发送' })
          updateRecord(entry.recordId, { status: 'rejected', error: '应用已停止，未自动发送' })
        } else if (entry.draft.state === 'approved') {
          updateDraft(entry, { state: 'pending' })
        }
        // Preserve manual drafts; detach queued jobs so shutdown cannot start another send.
        finish(entry)
      }
      await Promise.allSettled([...pendingGenerations, sendChain])
    },
    handle,
    enqueueDraft,
    listGenerating() { return [...generatingNames].map(([sessionId, name]) => ({ sessionId, name })) },
    listDrafts() {
      const t = now()
      const drafts = deps.records.listDrafts()
      for (const d of drafts) {
        if (d.state === 'pending' && d.expiresAt !== undefined && d.expiresAt <= t) {
          d.state = 'expired'
          deps.records.saveDraft(d)
          const entry = live.get(d.id)
          if (entry) {
            updateRecord(entry.recordId, { status: 'rejected', error: '超时未确认' })
            finish(entry)
          }
        }
      }
      return drafts
    },
    async resolveDraft(draftId, decision, text) {
      const entry = live.get(draftId)
      if (!entry) throw new Error('草稿不存在或已处理')
      if (entry.draft.state !== 'pending') throw new Error(`草稿当前状态为 ${entry.draft.state}，无法处理`)
      if (entry.draft.expiresAt !== undefined && entry.draft.expiresAt <= now()) {
        updateDraft(entry, { state: 'expired', error: '超时未确认' })
        updateRecord(entry.recordId, { status: 'rejected', error: '超时未确认' })
        finish(entry)
        throw new Error('草稿已过期，请根据最新消息重新生成')
      }
      if (decision === 'reject') {
        updateDraft(entry, { state: 'rejected' })
        updateRecord(entry.recordId, { status: 'rejected' })
        finish(entry)
        return
      }
      const finalText = decision === 'edit' ? (text ?? '').trim() : entry.draft.draft
      if (!finalText) throw new Error('回复内容不能为空')
      updateDraft(entry, { state: 'approved', draft: finalText })
      await send(entry, finalText)
      if ((entry.draft as ReplyDraft).state !== 'sent') throw new Error(entry.draft.error ?? '发送未完成')
    },
    invalidate(sessionId, reason) {
      generations.get(sessionId)?.abort()
      finishGeneration(sessionId)
      supersede(sessionId, reason)
    },
    hold(draftId) {
      const entry = live.get(draftId)
      if (!entry || entry.draft.state !== 'pending') throw new Error('草稿不存在或已开始发送')
      clearTimer(entry)
      updateDraft(entry, { mode: 'confirm', countdownEndsAt: undefined, expiresAt: now() + draftTtl })
    },
    async retry(draftId) {
      const draft = deps.records.getDraft(draftId)
      if (!draft || !['failed', 'pending'].includes(draft.state)) throw new Error('草稿已处理，无法重新生成')
      if (halted) throw new Error(haltReason ?? '请先恢复自动回复')
      const blocked = await deps.canSend?.(draft)
      if (blocked) throw new Error(blocked)
      if (draft.draft && draft.state === 'failed') {
        const entry = track({ ...draft, state: 'pending', mode: 'confirm', error: undefined }, { recordId: draft.recordId, contextToken: draft.contextToken })
        persistDraft(entry.draft)
        await service.resolveDraft(draft.id, 'approve')
      } else {
        const rule = deps.records.getRule(draft.source.chatId)
        if (!rule?.enabled) throw new Error('规则已暂停或删除')
        service.invalidate(draft.source.chatId, '正在重新生成候选')
        persistDraft({ ...draft, state: 'rejected' })
        const event: MessageEvent = { id: `retry_${nanoid(10)}`, source: draft.source, kind: 'text', text: draft.triggerText, timestamp: now(), addressed: true, raw: { accountId: draft.accountId, context_token: draft.contextToken } }
        await handle(event, { reply: true, reason: 'ok' }, draft.source.chatId as SessionKey, { manualRetry: true })
      }
    },
    cancel(draftId) {
      const entry = live.get(draftId)
      if (!entry || entry.draft.state !== 'pending') return
      updateDraft(entry, { state: 'rejected', error: '已取消' })
      updateRecord(entry.recordId, { status: 'rejected', error: '已取消' })
      finish(entry)
    },
    halt(reason) {
      if (halted) return
      halted = true
      haltReason = reason
      for (const controller of generations.values()) controller.abort()
      for (const id of [...generations.keys()]) finishGeneration(id)
      for (const entry of [...live.values()]) {
        if (entry.draft.state === 'pending' && entry.draft.mode === 'auto') {
          updateDraft(entry, { state: 'expired', error: `已熔断：${reason}` })
          updateRecord(entry.recordId, { status: 'rejected', error: `已熔断：${reason}` })
          finish(entry)
        }
      }
      emit({ type: 'autoreply.halted', reason })
    },
    resume() {
      halted = false
      haltReason = undefined
    },
    get halted() {
      return halted
    },
    get haltReason() {
      return haltReason
    },
    async recall(recordId) {
      const record = deps.records.getRecord(recordId)
      if (!record) return { ok: false, error: '记录不存在' }
      if (record.status !== 'sent') return { ok: false, error: '只能撤回已发送的消息' }
      if (record.recallableUntil === undefined) return { ok: false, error: '当前通道不支持撤回' }
      if (record.recallableUntil < now()) return { ok: false, error: '已超过 2 分钟撤回时限' }
      // TODO(channel): no adapter implements recall yet (iLink has no recall endpoint).
      return { ok: false, error: '当前通道不支持撤回' }
    },
    events: { on: events.on },
  }
  return service
}
