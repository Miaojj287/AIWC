/**
 * UI-injection sender (channel 'wechat-ui'): types into the real WeChat client, then proves the
 * message landed by reading it back from the local database (ARCHITECTURE §7).
 *
 * Safety core (ported from the reference implementation):
 *  - one serial queue — keyboard injection is a global resource, concurrency interleaves keystrokes
 *  - per bubble: focus (first bubble only) → fill → commit → read-back poll (≤ 6s)
 *  - the read-back is UNFILTERED on purpose so it reaches WeChat's live database; a filtered query
 *    only sees the local mirror, whose background sync is slower than the verify window
 *  - on miss: press Enter ONCE more, never re-paste (a real send leaves the composer empty, so a
 *    second Enter is a no-op; a second paste would double-send)
 *  - still missing: probe up to 3 other recently-changed sessions → 'wrong-session'
 *  - any non-ok verdict → halt latch: queue cleared, nothing sends until resume()
 */
import type { AdapterState, GatewayEvent, PlatformAdapter, SendRequest, SendResult, SubstrateService, WxMessage } from '@aiwc/protocol'
import { createEmitter, errorMessage, sleep as defaultSleep } from '../../core/emitter'
import { shapeOutboundText } from '../../adapters/ilink/textSplit'
import { INJECT_FAILURE_TEXT, InjectorError, createInjector, type WeChatInjector } from './injectors'

export type VerifyVerdict = { verdict: 'ok'; message: WxMessage } | { verdict: 'wrong-session'; where: string } | { verdict: 'not-sent' }

export interface UiInjectSenderDeps {
  substrate: Pick<SubstrateService, 'listMessages' | 'listSessions' | 'getSession'>
  platform: 'darwin' | 'win32' | 'linux' | string
  injector?: WeChatInjector
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  verifyTimeoutMs?: number
  verifyPollMs?: number
  /** Tolerance for clock skew between the injected send and the DB row (ms). */
  verifyClockSlackMs?: number
  strayProbeLimit?: number
  /** Pause between bubbles of one message (min,max ms). */
  segmentGapMs?: [number, number]
  itemGapMs?: [number, number]
  /** Host may cancel queued work (rule / account changes) before keyboard injection. */
  canSend?: (req: SendRequest) => Promise<string | undefined>
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface UiInjectSender {
  send(req: SendRequest): Promise<SendResult>
  readonly halted: boolean
  readonly haltReason: string | undefined
  /** Manual acknowledgement after a halt; nothing sends until this is called. */
  resume(): void
  events: { on(listener: (e: GatewayEvent) => void): () => void }
  /** Expose as a PlatformAdapter so gateway.outbound can route 'wechat-ui' here. */
  asAdapter(): PlatformAdapter
  readonly queued: number
}

const VERIFY_TIMEOUT_MS = 6000
const VERIFY_POLL_MS = 400
const VERIFY_SLACK_MS = 5000
/** Messages read back per verification probe. One send can only add a handful of rows. */
const TAIL_LIMIT = 20
const STRAY_PROBE_LIMIT = 3
const SEGMENT_GAP_MS: [number, number] = [900, 2600]

const HALT_TEXT: Record<string, string> = {
  'wrong-session': '发到了别的会话，已停止后续发送',
  'not-sent': '没能确认消息已发出，已停止后续发送',
  ...INJECT_FAILURE_TEXT,
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

type Job = { req: SendRequest; resolve: (r: SendResult) => void }

export function createUiInjectSender(deps: UiInjectSenderDeps): UiInjectSender {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? defaultSleep
  const injector = deps.injector ?? createInjector(deps.platform)
  const verifyTimeout = deps.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS
  const verifyPoll = deps.verifyPollMs ?? VERIFY_POLL_MS
  const slack = deps.verifyClockSlackMs ?? VERIFY_SLACK_MS
  const strayLimit = deps.strayProbeLimit ?? STRAY_PROBE_LIMIT
  const gap = deps.segmentGapMs ?? SEGMENT_GAP_MS
  const itemGap = deps.itemGapMs ?? [2500, 7000]

  const events = createEmitter<GatewayEvent>()
  const states = createEmitter<{ state: AdapterState; detail?: string }>()
  const queue: Job[] = []
  let draining = false
  let halted = false
  let haltReason: string | undefined

  // ── verification ─────────────────────────────────────────────────────────────────────────────
  /**
   * Read the tail of a chat straight from WeChat's own database.
   *
   * The query deliberately carries NO `from` / `kinds` filter: the substrate answers a *filtered*
   * listMessages out of its local mirror alone, and the mirror only catches up when the background
   * sync run for that session finishes. Verifying against the mirror therefore races a sync whose
   * latency grows with the size of the account — the message really was delivered, we just could
   * not see it yet, and the sender halted on its own success. An unfiltered latest-page query goes
   * to the live message shards, which is where the row we are looking for already is.
   */
  async function tail(sessionId: string): Promise<WxMessage[]> {
    const res = await deps.substrate.listMessages({ sessionId, limit: TAIL_LIMIT })
    return res.items
  }

  const isMine = (m: WxMessage, expected: string, sentAt: number, before: Set<string>): boolean =>
    m.isSelf && !before.has(m.id) && m.createdAt >= sentAt - slack && norm(m.text) === expected

  async function findMine(sessionId: string, expected: string, sentAt: number, before = new Set<string>()): Promise<WxMessage | undefined> {
    return (await tail(sessionId)).find((m) => isMine(m, expected, sentAt, before))
  }

  async function verify(sessionId: string, text: string, sentAt: number, before = new Set<string>()): Promise<VerifyVerdict> {
    const expected = norm(text)
    const deadline = now() + verifyTimeout
    // Poll: WeChat commits its own write a few hundred ms after the composer clears.
    for (;;) {
      await sleep(verifyPoll)
      const hit = await findMine(sessionId, expected, sentAt, before)
      if (hit) return { verdict: 'ok', message: hit }
      if (now() >= deadline) break
    }
    return { verdict: 'not-sent' }
  }

  /**
   * "Sent to the wrong chat" must be proven by finding OUR text in another session — a changed
   * timestamp alone is not evidence, people keep messaging us while we send.
   */
  async function probeStray(sessionId: string, text: string, sentAt: number): Promise<VerifyVerdict> {
    const expected = norm(text)
    const sessions = await deps.substrate.listSessions({ limit: 30 })
    const suspects = sessions.items.filter((s) => s.id !== sessionId && (s.lastMessageAt ?? 0) >= sentAt - slack).slice(0, strayLimit)
    log('warn', 'probing other chats for a stray send', { sessionId, suspects: suspects.map((s) => s.id) })
    for (const s of suspects) {
      if (await findMine(s.id, expected, sentAt)) return { verdict: 'wrong-session', where: s.title || s.id }
    }
    return { verdict: 'not-sent' }
  }

  // ── halt latch ───────────────────────────────────────────────────────────────────────────────
  function halt(reason: string, detail?: string): SendResult {
    halted = true
    haltReason = detail ?? HALT_TEXT[reason] ?? reason
    for (const job of queue.splice(0)) job.resolve({ ok: false, verified: false, error: `自动发送已熔断：${haltReason}` })
    log('error', 'ui-inject halted', { reason, detail })
    events.emit({ type: 'autoreply.halted', reason: haltReason })
    states.emit({ state: 'error', detail: haltReason })
    return { ok: false, verified: false, error: haltReason }
  }

  // ── one request ──────────────────────────────────────────────────────────────────────────────
  async function resolveSearchName(req: SendRequest): Promise<string> {
    if (req.to.displayName?.trim()) return req.to.displayName.trim()
    try {
      const session = await deps.substrate.getSession(req.to.chatId)
      if (session?.title) return session.title
    } catch (err) {
      log('debug', 'getSession failed for search name', errorMessage(err))
    }
    return req.to.chatId
  }

  async function process(req: SendRequest): Promise<SendResult> {
    const blocked = await deps.canSend?.(req)
    if (blocked) return { ok: false, error: blocked }
    const sessionId = req.to.chatId
    const bubbles = req.parts.flatMap((p) => (p.type === 'text' ? shapeOutboundText(p.text, 2000) : []))
    if (req.parts.some((p) => p.type !== 'text')) return { ok: false, error: 'UI 注入通道只支持文本' }
    if (bubbles.length === 0) return { ok: false, error: '没有可发送的文本' }
    const searchName = await resolveSearchName(req)

    let lastId: string | undefined
    for (const [i, bubble] of bubbles.entries()) {
      const changed = await deps.canSend?.(req)
      if (changed) return i > 0 ? halt('not-sent', `后续消息已取消：${changed}`) : { ok: false, error: changed }
      const before = new Set((await tail(sessionId)).map((message) => message.id))
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            if (i === 0) await injector.focusSession(searchName)
            await injector.fill(bubble)
            break
          } catch (error) {
            if (!(error instanceof InjectorError) || error.reason !== 'busy' || attempt >= 2) throw error
            await sleep(1200)
          }
        }
      } catch (err) {
        const reason = err instanceof InjectorError ? err.reason : 'not-sent'
        return halt(reason, err instanceof InjectorError && !injector.detailedErrors ? undefined : errorMessage(err))
      }
      const beforeCommit = await deps.canSend?.(req)
      if (beforeCommit) return halt('not-sent', `发送前状态变化，已停止：${beforeCommit}`)
      const sentAt = now()
      try {
        await injector.commit()
      } catch (err) {
        const reason = err instanceof InjectorError ? err.reason : 'not-sent'
        return halt(reason, err instanceof InjectorError && !injector.detailedErrors ? undefined : errorMessage(err))
      }

      let result = await verify(sessionId, bubble, sentAt, before)
      let retried = false
      if (result.verdict === 'not-sent' && injector.retryCommit !== false) {
        // The text is most likely still sitting in the composer: one more Enter, never a re-paste.
        // Safe even if the user switched chats meanwhile — WeChat keeps a draft per conversation,
        // so an Enter in a chat we never pasted into lands on an empty composer and does nothing.
        retried = true
        try {
          await injector.commit()
          result = await verify(sessionId, bubble, sentAt, before)
        } catch (err) {
          log('warn', 'retry commit failed', errorMessage(err))
        }
      }
      if (result.verdict === 'not-sent') result = await probeStray(sessionId, bubble, sentAt)
      if (result.verdict !== 'ok') {
        return halt(result.verdict, result.verdict === 'wrong-session' ? `发到了「${result.where}」，已停止后续发送` : undefined)
      }
      // A steady stream of `retried: true` means the paste settle is too short for this machine.
      log(retried ? 'warn' : 'debug', 'ui-inject bubble verified', { sessionId, index: i, of: bubbles.length, chars: bubble.length, retried })
      lastId = result.message.id
      if (i < bubbles.length - 1) await sleep(gap[0] + Math.floor(Math.random() * Math.max(0, gap[1] - gap[0] + 1)))
    }
    return { ok: true, verified: true, messageId: lastId }
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0 && !halted) {
        const job = queue.shift()
        if (!job) break
        let result: SendResult
        try {
          result = await process(job.req)
        } catch (err) {
          result = halt('not-sent', errorMessage(err))
        }
        job.resolve(result)
        if (queue.length && !halted) await sleep(itemGap[0]! + Math.floor(Math.random() * Math.max(0, itemGap[1]! - itemGap[0]! + 1)))
      }
    } finally {
      draining = false
    }
  }

  const sender: UiInjectSender = {
    send(req) {
      if (halted) return Promise.resolve({ ok: false, verified: false, error: `自动发送已熔断：${haltReason ?? ''}` })
      return new Promise<SendResult>((resolve) => {
        queue.push({ req, resolve })
        void drain()
      })
    },
    get halted() {
      return halted
    },
    get haltReason() {
      return haltReason
    },
    get queued() {
      return queue.length
    },
    resume() {
      if (!halted) return
      halted = false
      haltReason = undefined
      states.emit({ state: 'connected' })
      void drain()
    },
    events: { on: events.on },
    asAdapter() {
      return {
        channel: 'wechat-ui',
        capabilities: { typing: false, media: ['text'], splitsLongMessages: false, maxTextLength: 2000 },
        get state(): AdapterState {
          return halted ? 'error' : 'connected'
        },
        async connect() {},
        async disconnect() {},
        onMessage: () => () => {},
        onStateChange: (handler) => states.on(({ state, detail }) => handler(state, detail)),
        send: (req) => sender.send(req),
      }
    },
  }
  return sender
}
