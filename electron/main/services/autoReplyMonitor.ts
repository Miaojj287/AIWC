/**
 * Local WeChat equivalent of AIWC_ORG's ReplyTileService. The host owns observation; an open chat
 * tab is never required.
 *
 * A chat becomes eligible the moment its rule is switched on, and the FIRST thing that happens is a
 * catch-up: if the peer's message is still the last one in that chat, nobody has answered it, so it
 * is answered now. Waiting for the next inbound instead — the old behaviour — meant turning the
 * switch on in front of an unanswered message did nothing at all, which is the one moment the user
 * most expects it to act.
 *
 * The catch-up is self-limiting rather than time-boxed: once a reply lands, the last message is
 * ours, so a restart / reconnect / re-enable finds nothing to catch up on. It only ever fires while
 * the peer genuinely has the last word.
 */
import type { AutoReplyRule, MessageEvent, SubstrateService, WxMessage, WxSession } from '@aiwc/protocol'

/**
 * How stale a *newly arrived* message may be and still be answered. This guards the incremental
 * path against a clock jump or a bulk re-index replaying old rows as if they were new; it is
 * deliberately NOT applied to the catch-up, where answering an old unanswered message is the point.
 */
const NEW_MESSAGE_MAX_AGE_MS = 10 * 60_000

export interface AutoReplyMonitorDeps {
  substrate: SubstrateService
  rules(): AutoReplyRule[]
  bindRule?(rule: AutoReplyRule, accountId: string): void
  /** `force` re-attempts a message the service already tried (the manual trigger). */
  ingest(event: MessageEvent, opts?: { force?: boolean }): Promise<void>
  invalidate(sessionId: string, reason: string): void
  accountChanged(): void
  quietMs?: number
  pollMs?: number
  now?: () => number
  onError?(error: unknown): void
}

export function createAutoReplyMonitor(deps: AutoReplyMonitorDeps) {
  const now = deps.now ?? Date.now
  const baseline = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let account: string | undefined
  let running = false
  let checking = false
  let again = false
  let generation = 0
  /**
   * Set for the pass that follows a WeChat account switch. Re-seeding under a different account is
   * not the user activating anything, and the other account's unanswered messages are not a backlog
   * this account should answer — so that one pass seeds silently. Left set if the pass bails out
   * early, which errs towards sending nothing.
   */
  let suppressCatchUp = false
  let poll: ReturnType<typeof setInterval> | undefined
  let off: (() => void) | undefined

  const keyOf = (m: WxMessage | undefined): string => (m ? `${m.id}:${m.seq}:${m.createdAt}` : '')

  const replyable = (m: WxMessage | undefined): m is WxMessage =>
    Boolean(m) && !m!.isSelf && m!.kind !== 'system' && m!.kind !== 'revoke'

  function toEvent(session: WxSession, last: WxMessage, owner: string, nickname: string | undefined): MessageEvent {
    return {
      id: `${owner}:${session.id}:${last.id}:${last.seq}`,
      source: { channel: 'wechat-ui', chatId: session.id, peerId: last.senderId, chatType: session.kind === 'group' ? 'group' : 'dm', displayName: session.title },
      kind: ['image', 'voice', 'file', 'video', 'sticker'].includes(last.kind) ? last.kind as MessageEvent['kind'] : 'text',
      text: last.media?.transcript || last.text || `[${last.kind}]`,
      timestamp: last.createdAt,
      addressed: session.kind === 'dm' || Boolean(nickname && last.text.includes(`@${nickname}`)),
      replyTo: last.quote ? { messageId: '', text: last.quote.text, authorName: last.quote.senderName } : undefined,
      raw: { isSelf: false, accountId: owner, localMessageId: last.id, senderName: last.senderName },
    }
  }

  const cancel = (id: string, reason: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    deps.invalidate(id, reason)
  }
  const reset = (reason: string) => {
    generation++
    for (const id of baseline.keys()) cancel(id, reason)
    baseline.clear()
  }

  async function refresh(): Promise<void> {
    if (!running) return
    if (checking) { again = true; return }
    checking = true
    try {
      const status = deps.substrate.status()
      const nextAccount = status.account?.wxid
      if (account && account !== nextAccount) { reset('微信账户已切换'); suppressCatchUp = true; deps.accountChanged() }
      account = nextAccount
      if (status.connection !== 'ready' || !account) { reset('微信数据未连接'); return }
      const epoch = generation
      const owner = account
      const rules = deps.rules().filter((r) => r.enabled && !r.pausedReason && (!r.accountId || r.accountId === owner))
      const ids = new Set(rules.map((r) => r.sessionId))
      for (const id of baseline.keys()) if (!ids.has(id)) { cancel(id, '规则已暂停或删除'); baseline.delete(id) }
      for (const rule of rules) {
        if (!rule.accountId) deps.bindRule?.(rule, owner)
        const session = await deps.substrate.getSession(rule.sessionId)
        if (!session || (session.kind !== 'dm' && session.kind !== 'group')) continue
        const result = await deps.substrate.listMessages({ sessionId: session.id, limit: 1 })
        if (!running || generation !== epoch || deps.substrate.status().account?.wxid !== owner) return
        const last = result.items.at(-1)
        const key = keyOf(last)
        const previous = baseline.get(session.id)
        baseline.set(session.id, key)
        if (previous === key) continue
        // First time we look at this chat = the rule was just switched on (or the app / connection
        // just came back). Answer whatever is still unanswered instead of waiting for one more.
        const catchUp = previous === undefined
        if (catchUp && suppressCatchUp) continue // seed the baseline only; see suppressCatchUp
        if (!catchUp) cancel(session.id, last?.isSelf ? '你已在微信中回复' : '对方发来了新消息')
        if (!replyable(last)) continue
        if (!catchUp && now() - last.createdAt > NEW_MESSAGE_MAX_AGE_MS) continue
        const event = toEvent(session, last, owner, status.account?.nickname)
        timers.set(session.id, setTimeout(() => {
          timers.delete(session.id)
          if (!running || generation !== epoch || baseline.get(session.id) !== key) return
          const current = deps.rules().find((r) => r.sessionId === session.id)
          if (!current?.enabled || (current.accountId && current.accountId !== owner)) return
          void deps.ingest(event).catch(deps.onError ?? (() => {}))
        }, deps.quietMs ?? 5000))
      }
      suppressCatchUp = false
    } catch (error) { deps.onError?.(error) }
    finally {
      checking = false
      if (again) { again = false; void refresh() }
    }
  }

  /**
   * Reply to this chat's last message right now — the "立即触发一次" button.
   *
   * Bypasses the quiet window and the already-attempted latch, because the user asking for it is a
   * stronger signal than either. It still refuses when there is genuinely nothing to answer, and
   * says which of those it is: a button that silently does nothing is worse than no button.
   */
  async function triggerNow(sessionId: string): Promise<{ triggered: boolean; reason?: string }> {
    const status = deps.substrate.status()
    const owner = status.account?.wxid
    if (status.connection !== 'ready' || !owner) return { triggered: false, reason: '微信数据未连接' }
    const rule = deps.rules().find((r) => r.sessionId === sessionId)
    if (!rule?.enabled) return { triggered: false, reason: '这个会话的自动回复没有开启' }
    if (rule.accountId && rule.accountId !== owner) return { triggered: false, reason: '规则属于另一个微信账户' }
    const session = await deps.substrate.getSession(sessionId)
    if (!session || (session.kind !== 'dm' && session.kind !== 'group')) return { triggered: false, reason: '找不到这个会话' }
    const last = (await deps.substrate.listMessages({ sessionId, limit: 1 })).items.at(-1)
    if (!last) return { triggered: false, reason: '这个会话还没有消息' }
    if (last.isSelf) return { triggered: false, reason: '最后一条是你发的，没有待回复的消息' }
    if (!replyable(last)) return { triggered: false, reason: '最后一条消息不支持自动回复' }

    cancel(sessionId, '已手动触发一次自动回复')
    baseline.set(sessionId, keyOf(last))
    await deps.ingest(toEvent(session, last, owner, status.account?.nickname), { force: true })
    return { triggered: true }
  }

  return {
    refresh,
    triggerNow,
    start() {
      if (running) return
      running = true
      off = deps.substrate.subscribe(() => { void refresh() })
      poll = setInterval(() => { void refresh() }, deps.pollMs ?? 3000)
      void refresh()
    },
    stop() {
      running = false
      generation++
      off?.()
      clearInterval(poll)
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      baseline.clear()
    },
  }
}
