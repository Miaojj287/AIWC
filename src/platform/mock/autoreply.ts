/**
 * autoreply:* (rules, drafts, records — all in memory; enabling a rule produces a draft for that
 * session shortly after) and gateway:* (adapter states with a mocked iLink login).
 */
import type { AdapterState, AutoReplyRecord, AutoReplyRule, ChannelKind, ReplyDraft, WxMessage } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'
import { qrPlaceholderSvg } from './media'

export interface AutoReplyModule extends HandlersFor<'autoreply'>, HandlersFor<'gateway'> {
  rules(): AutoReplyRule[]
}

const RECALL_WINDOW_MS = 2 * 60_000

export function autoreplyHandlers(ctx: MockContext): AutoReplyModule {
  const { data } = ctx
  const rules = new Map<string, AutoReplyRule>()
  const drafts = new Map<string, ReplyDraft>()
  const records: AutoReplyRecord[] = []
  let halted = false
  const adapters = new Map<ChannelKind, { state: AdapterState; detail?: string }>([
    ['desktop', { state: 'connected' }],
    ['wechat-ilink', { state: 'disconnected' }],
    ['wechat-ui', { state: 'disconnected' }],
  ])

  const todayKey = () => new Date(ctx.now()).toDateString()
  const withDerived = (r: AutoReplyRule): AutoReplyRule => ({
    ...r,
    todayCount: records.filter((x) => x.ruleId === r.id && x.status === 'sent' && new Date(x.at).toDateString() === todayKey()).length,
    pausedReason: halted && r.enabled ? '发送通道已熔断，等待手动恢复' : r.enabled ? undefined : r.pausedReason,
  })

  const emitDraft = (d: ReplyDraft) => ctx.emit('autoreply:draft', { ...d })

  function latestTrigger(sessionId: string): WxMessage | undefined {
    const list = data.messagesBySession.get(sessionId) ?? []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m && !m.isSelf && m.kind !== 'system' && m.kind !== 'revoke') return m
    }
    return undefined
  }

  function fillTemplate(text: string, rule: AutoReplyRule, trigger: WxMessage): string {
    const session = data.sessions.get(rule.sessionId)
    const t = new Date(ctx.now())
    return text
      .replaceAll('{昵称}', trigger.senderName ?? '')
      .replaceAll('{时间}', `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)
      .replaceAll('{群名}', session?.title ?? '')
  }

  function aiDraft(rule: AutoReplyRule, trigger: WxMessage): string {
    const mine = (data.messagesBySession.get(rule.sessionId) ?? []).filter((m) => m.isSelf && m.kind === 'text' && m.text.length > 3)
    const base = mine.length ? ctx.rng.pick(mine).text : '我看到了，稍后回复你。'
    return trigger.senderName && data.sessions.get(rule.sessionId)?.kind === 'group' ? `@${trigger.senderName} ${base}` : base
  }

  function send(draft: ReplyDraft, text: string) {
    const rule = [...rules.values()].find((r) => r.id === draft.ruleId)
    const trigger = data.messageById.get(draft.triggerMessageId)
    const at = ctx.now()
    const record: AutoReplyRecord = {
      id: ctx.id('rec'),
      ruleId: draft.ruleId ?? '',
      sessionId: draft.source.chatId,
      triggerMessage: { id: draft.triggerMessageId, text: draft.triggerText, senderName: trigger?.senderName, at: trigger?.createdAt ?? at },
      replyText: text,
      at,
      status: 'sent',
      recallableUntil: at + RECALL_WINDOW_MS,
    }
    records.unshift(record)
    draft.state = 'sent'
    draft.draft = text
    emitDraft(draft)
    ctx.emit('autoreply:record', record)
    ctx.emit('gateway:event', { type: 'outbound', req: { to: draft.source, parts: [{ type: 'text', text }], reason: 'auto_reply' }, result: { ok: true, messageId: record.id, verified: true } })
    if (rule) ctx.emit('app:toast', { kind: 'success', text: `已自动回复「${data.sessions.get(rule.sessionId)?.title ?? ''}」` })
  }

  async function scheduleDraft(rule: AutoReplyRule): Promise<void> {
    await ctx.delay(1500)
    const current = rules.get(rule.sessionId)
    if (!current || !current.enabled || current.id !== rule.id) return
    const trigger = latestTrigger(rule.sessionId)
    if (!trigger) return
    const session = data.sessions.get(rule.sessionId)
    const text = current.source === 'fixed' ? fillTemplate(current.fixedText ?? '', current, trigger) : aiDraft(current, trigger)
    const mode: ReplyDraft['mode'] = 'auto'
    const now = ctx.now()
    const countdownMs = ctx.config().autoReply.countdownMs
    const draft: ReplyDraft = {
      id: ctx.id('draft'),
      ruleId: current.id,
      source: { channel: 'wechat-ui', peerId: trigger.senderId, chatId: rule.sessionId, chatType: session?.kind === 'group' ? 'group' : 'dm', displayName: session?.title },
      triggerMessageId: trigger.id,
      triggerText: trigger.text || trigger.media?.transcript || `[${trigger.kind}]`,
      draft: text,
      suggestions: undefined,
      state: 'pending',
      createdAt: now,
      expiresAt: now + 30 * 60_000,
      mode,
      countdownEndsAt: mode === 'auto' ? now + countdownMs : undefined,
    }
    drafts.set(draft.id, draft)
    emitDraft(draft)
    ctx.emit('gateway:event', { type: 'autoreply.queued', draftId: draft.id })
    if (mode === 'auto') {
      const ticks = 5
      for (let i = ticks; i > 0; i--) {
        ctx.emit('gateway:event', { type: 'autoreply.countdown', draftId: draft.id, remainingMs: Math.round((countdownMs * i) / ticks) })
        await ctx.delay(countdownMs / ticks)
        if (draft.state !== 'pending' || draft.mode !== 'auto') return
      }
      if (halted) {
        draft.state = 'failed'
        draft.error = '发送通道已熔断'
        emitDraft(draft)
        return
      }
      send(draft, draft.draft)
    }
  }

  function setAdapter(channel: ChannelKind, state: AdapterState, detail?: string) {
    adapters.set(channel, { state, detail })
    ctx.emit('gateway:event', { type: 'adapter.state', channel, state, detail })
  }

  async function connect(channel: ChannelKind): Promise<void> {
    setAdapter(channel, 'connecting')
    if (channel === 'wechat-ilink') {
      await ctx.delay(1000)
      setAdapter(channel, 'needs_login', '请用微信扫码')
      ctx.emit('gateway:event', { type: 'login.qr', channel, qrDataUrl: qrPlaceholderSvg(`ilink:${ctx.now()}`) })
      await ctx.delay(2500)
    } else {
      await ctx.delay(800)
    }
    if (adapters.get(channel)?.state === 'disconnected') return // disconnected while connecting
    setAdapter(channel, 'connected')
  }

  return {
    rules: () => [...rules.values()],
    'autoreply:listRules': () => [...rules.values()].map(withDerived),
    'autoreply:getRule': ({ sessionId }) => {
      const r = rules.get(sessionId)
      return r ? withDerived(r) : undefined
    },
    'autoreply:saveRule': (rule) => {
      const saved: AutoReplyRule = { ...rule, id: rule.id || ctx.id('rule'), updatedAt: ctx.now() }
      const wasEnabled = rules.get(rule.sessionId)?.enabled ?? false
      rules.set(rule.sessionId, saved)
      ctx.emit('autoreply:rulesChanged', { sessionId: rule.sessionId })
      if (saved.enabled && !wasEnabled) void scheduleDraft(saved)
      return withDerived(saved)
    },
    'autoreply:setEnabled': ({ sessionId, enabled }) => {
      const r = rules.get(sessionId)
      if (!r) throw new Error('该会话还没有自动回复规则')
      const was = r.enabled
      r.enabled = enabled
      ctx.emit('autoreply:rulesChanged', { sessionId })
      r.updatedAt = ctx.now()
      if (enabled && !was) void scheduleDraft(r)
      if (!enabled)
        for (const d of drafts.values())
          if (d.ruleId === r.id && d.state === 'pending') {
            d.state = 'expired'
            emitDraft(d)
          }
    },
    'autoreply:deleteRule': ({ sessionId }) => {
      const r = rules.get(sessionId)
      rules.delete(sessionId)
      ctx.emit('autoreply:rulesChanged', { sessionId })
      if (r) for (const d of drafts.values()) if (d.ruleId === r.id && d.state === 'pending') d.state = 'expired'
    },
    'autoreply:listRecords': ({ sessionId, status, limit = 50 }) =>
      records.filter((r) => (!sessionId || r.sessionId === sessionId) && (!status || r.status === status)).slice(0, limit),
    'autoreply:recall': async ({ recordId }) => {
      const r = records.find((x) => x.id === recordId)
      if (!r) return { ok: false, error: '记录不存在' }
      if (r.status !== 'sent') return { ok: false, error: '只有已发送的回复可以撤回' }
      if ((r.recallableUntil ?? 0) < ctx.now()) return { ok: false, error: '已超过 2 分钟撤回时限' }
      await ctx.delay(400)
      r.status = 'recalled'
      ctx.emit('autoreply:record', r)
      return { ok: true }
    },
    'autoreply:listDrafts': () => [...drafts.values()].filter((d) => d.state === 'pending').sort((a, b) => a.createdAt - b.createdAt),
    'autoreply:resolveDraft': ({ draftId, decision, text }) => {
      const d = drafts.get(draftId)
      if (!d || d.state !== 'pending') return
      if (decision === 'reject') {
        d.state = 'rejected'
        emitDraft(d)
        const trigger = data.messageById.get(d.triggerMessageId)
        const rec: AutoReplyRecord = { id: ctx.id('rec'), ruleId: d.ruleId ?? '', sessionId: d.source.chatId, triggerMessage: { id: d.triggerMessageId, text: d.triggerText, senderName: trigger?.senderName, at: trigger?.createdAt ?? ctx.now() }, replyText: d.draft, at: ctx.now(), status: 'rejected' }
        records.unshift(rec)
        ctx.emit('autoreply:record', rec)
        return
      }
      if (halted) {
        d.state = 'failed'
        d.error = '发送通道已熔断，请先恢复'
        emitDraft(d)
        return
      }
      send(d, decision === 'edit' && text ? text : d.draft)
    },
    'autoreply:holdDraft': ({ draftId }) => {
      const d = drafts.get(draftId)
      if (!d || d.state !== 'pending') throw new Error('草稿已处理')
      d.mode = 'confirm'; d.countdownEndsAt = undefined; emitDraft(d)
    },
    'autoreply:retryDraft': async ({ draftId }) => {
      const d = drafts.get(draftId)
      if (!d || !['failed', 'pending'].includes(d.state)) throw new Error('草稿不可重试')
      if (halted) throw new Error('请先恢复自动回复')
      if (d.state === 'failed' && d.draft) send(d, d.draft)
      else {
        const rule = rules.get(d.source.chatId)
        if (!rule) throw new Error('规则不存在')
        d.state = 'rejected'; emitDraft(d)
        await scheduleDraft(rule)
      }
    },
    'autoreply:status': () => ({ halted: halted ? '发送通道已熔断' : undefined, connection: 'ready', demo: true, queued: 0, generating: [] }),
    'autoreply:triggerNow': ({ sessionId }) => {
      const rule = rules.get(sessionId)
      if (!rule?.enabled) return { triggered: false, reason: '这个会话的自动回复没有开启' }
      if (!latestTrigger(sessionId)) return { triggered: false, reason: '最后一条是你发的，没有待回复的消息' }
      void scheduleDraft(rule)
      return { triggered: true }
    },
    'autoreply:resume': () => {
      halted = false
      ctx.emit('app:toast', { kind: 'success', text: '自动回复已恢复' })
    },

    'gateway:status': () => [...adapters.entries()].map(([channel, a]) => ({ channel, state: a.state, detail: a.detail })),
    'gateway:connect': ({ channel }) => {
      if (adapters.get(channel)?.state === 'connected') return
      void connect(channel)
    },
    'gateway:disconnect': ({ channel }) => setAdapter(channel, 'disconnected'),
  }
}
