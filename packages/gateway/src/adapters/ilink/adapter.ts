/**
 * iLink PlatformAdapter (channel 'wechat-ilink'): QR login state machine, long-poll receive loop
 * with reconnect/backoff + de-duplication, inbound normalisation to MessageEvent (media downloaded
 * into stateDir/media), and outbound text/media with context_token echo.
 *
 * State machine:
 *   needs_login ──connect()──▶ connecting (QR shown, polled) ──confirmed──▶ connected
 *   connected ──session expired──▶ needs_login          connected ──network error──▶ connected (retry w/ backoff)
 *   any ──disconnect()──▶ disconnected (session kept unless `forget`)
 */
import { join } from 'node:path'
import type { AdapterState, MessageEvent, OutboundPart, PlatformAdapter, SendRequest, SendResult, SessionSource } from '@aiwc/protocol'
import { createEmitter, errorMessage, sleep as defaultSleep } from '../../core/emitter'
import type { AdapterExtras } from '../../core/gateway'
import { checkOutboundMedia, type MediaRoots } from '../../core/mediaPolicy'
import { createIlinkClient, type IlinkClient, type IlinkClientOptions } from './client'
import { downloadAttachment, type FetchLike } from './media'
import {
  ILINK_BASE_URL,
  ILINK_MAX_TEXT_LENGTH,
  IlinkMessageType,
  incomingKind,
  incomingText,
  isSessionExpiredError,
  messageKey,
  messageTimestamp,
  parseIncomingMessage,
  type IlinkMessage,
  type IlinkSession,
} from './protocol'
import { createIlinkSessionStore, type IlinkSessionStore } from './sessionStore'
import { chunkText, splitExplicitBubbles } from './textSplit'

export interface IlinkAdapterOptions {
  stateDir: string
  /** Keep the QR-login token across app restarts. Defaults to true. */
  persistSession?: boolean
  onQr?: (dataUrl: string) => void
  /** Injectables (tests / composition). */
  fetch?: FetchLike
  client?: IlinkClient
  clientOptions?: IlinkClientOptions
  /** Render a QR payload string to a data URL; defaults to the `qrcode` package. */
  renderQr?: (content: string) => Promise<string>
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  qrDeadlineMs?: number
  qrPollMs?: number
  /** Pause between bubbles of one reply (min,max) to look less mechanical. 0 in tests. */
  bubblePauseMs?: [number, number]
  /** Minimum idle wait after an empty poll (guards against hot loops when the server answers instantly). */
  pollIdleMs?: number
  seenLimit?: number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
  /** Text patterns that mean "@me" in groups; iLink DMs are always addressed. */
  mentionPatterns?: readonly string[]
  /**
   * Directories outbound image / file / voice parts may be read from. Anything else is refused before
   * the file is opened (a bot thread must not be able to upload arbitrary local files to a contact).
   * Default: only this adapter's own inbound media dir (`stateDir/media`).
   */
  allowedMediaRoots?: MediaRoots
}

export interface IlinkAdapter extends PlatformAdapter, AdapterExtras {
  readonly channel: 'wechat-ilink'
  readonly session: IlinkSession | undefined
  onQr(handler: (dataUrl: string) => void): () => void
  /** Cancel an in-progress QR login without touching a stored session. */
  cancelLogin(): void
  /** Disconnect and forget the stored session (next connect shows a QR). */
  logout(): Promise<void>
  readonly lastError: string | undefined
}

const QR_DEADLINE_MS = 5 * 60_000
const QR_POLL_MS = 1000
const QR_MAX_REFRESH = 3
const RETRY_BASE_MS = 3000
const RETRY_MAX_MS = 60_000
const SEEN_LIMIT = 1000
const DEFAULT_BUBBLE_PAUSE: [number, number] = [700, 2200]

async function defaultRenderQr(content: string): Promise<string> {
  const mod = (await import('qrcode')) as unknown as { toDataURL?: (text: string, opts?: unknown) => Promise<string>; default?: { toDataURL(text: string, opts?: unknown): Promise<string> } }
  const toDataURL = mod.toDataURL ?? mod.default?.toDataURL
  if (!toDataURL) throw new Error('qrcode 模块不可用')
  return toDataURL(content, { width: 280, margin: 2, errorCorrectionLevel: 'H' })
}

export function ilinkSource(userId: string, displayName?: string): SessionSource {
  const chatType = userId.endsWith('@chatroom') ? 'group' : 'dm'
  return { channel: 'wechat-ilink', peerId: userId, chatId: userId, chatType, displayName }
}

export function createIlinkAdapter(opts: IlinkAdapterOptions): IlinkAdapter {
  const log = opts.logger ?? (() => {})
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? defaultSleep
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const client = opts.client ?? createIlinkClient({ fetch: fetchImpl, ...opts.clientOptions })
  const store: IlinkSessionStore = createIlinkSessionStore(opts.stateDir, { persist: opts.persistSession })
  const mediaDir = join(opts.stateDir, 'media')
  const allowedMediaRoots: MediaRoots = opts.allowedMediaRoots ?? [mediaDir]
  const renderQr = opts.renderQr ?? defaultRenderQr
  const qrDeadlineMs = opts.qrDeadlineMs ?? QR_DEADLINE_MS
  const qrPollMs = opts.qrPollMs ?? QR_POLL_MS
  const bubblePause = opts.bubblePauseMs ?? DEFAULT_BUBBLE_PAUSE
  const pollIdleMs = opts.pollIdleMs ?? 0
  const seenLimit = opts.seenLimit ?? SEEN_LIMIT

  const messages = createEmitter<MessageEvent>((err) => log('warn', 'ilink message listener threw', errorMessage(err)))
  const states = createEmitter<{ state: AdapterState; detail?: string }>()
  const qrEvents = createEmitter<string>()
  if (opts.onQr) qrEvents.on(opts.onQr)

  let session: IlinkSession | undefined = store.load()
  let state: AdapterState = session ? 'disconnected' : 'needs_login'
  let lastError: string | undefined
  let loopAbort: AbortController | undefined
  let loopDone: Promise<void> = Promise.resolve()
  let loginAbort: AbortController | undefined
  const seen = new Set<string>()
  const lastContextToken = new Map<string, string>()
  const typingTickets = new Map<string, string>()

  const setState = (next: AdapterState, detail?: string): void => {
    if (next === 'error') lastError = detail
    if (state === next && detail === undefined) return
    state = next
    states.emit({ state: next, detail })
  }

  const remember = (key: string): boolean => {
    if (seen.has(key)) return false
    seen.add(key)
    if (seen.size > seenLimit) {
      const first = seen.values().next().value
      if (first !== undefined) seen.delete(first)
    }
    return true
  }

  // ── inbound normalisation ────────────────────────────────────────────────────────────────────
  async function normalise(msg: IlinkMessage): Promise<MessageEvent | undefined> {
    const from = (msg.from_user_id ?? '').trim()
    if (!from) return undefined
    const parsed = parseIncomingMessage(msg)
    const text = incomingText(parsed)
    if (!text && parsed.attachments.length === 0) return undefined
    if (msg.context_token) lastContextToken.set(from, msg.context_token)

    const id = messageKey(msg)
    const mediaPaths: string[] = []
    for (const [i, attachment] of parsed.attachments.entries()) {
      if (!attachment.url) continue
      try {
        const downloaded = await downloadAttachment(fetchImpl, attachment, mediaDir, { id: `${id.replace(/[^a-z0-9]/gi, '')}_${i}` })
        mediaPaths.push(downloaded.path)
      } catch (err) {
        log('warn', 'ilink attachment download failed', { filename: attachment.filename, error: errorMessage(err) })
      }
    }

    return {
      id,
      source: ilinkSource(from),
      kind: incomingKind(parsed),
      text,
      mediaPaths: mediaPaths.length ? mediaPaths : undefined,
      timestamp: messageTimestamp(msg, now()),
      addressed: true, // iLink delivers only messages sent to the bot
      raw: msg,
    }
  }

  // ── receive loop ─────────────────────────────────────────────────────────────────────────────
  async function runLoop(signal: AbortSignal): Promise<void> {
    const current = session
    if (!current) return
    try {
      const r = await client.notifyStart(current)
      if (r && r.ret !== undefined && r.ret !== 0) log('warn', 'notifystart ret != 0', r)
    } catch (err) {
      log('warn', 'notifystart failed; polling anyway', errorMessage(err))
    }
    if (signal.aborted) return

    let buf = store.load()?.getUpdatesBuf ?? ''
    let failures = 0
    while (!signal.aborted && session) {
      try {
        const resp = await client.getUpdates(session, buf, signal)
        if (signal.aborted) break
        if (resp.ret !== undefined && resp.ret !== 0) log('warn', 'getupdates ret != 0', { ret: resp.ret, errmsg: resp.errmsg })
        if (resp.get_updates_buf && resp.get_updates_buf !== buf) {
          buf = resp.get_updates_buf
          store.saveCursor(buf)
        }
        failures = 0
        const msgs = resp.msgs ?? []
        for (const msg of msgs) {
          if (signal.aborted) break
          if (msg.message_type !== IlinkMessageType.USER) continue
          if (!remember(messageKey(msg))) continue
          const event = await normalise(msg)
          if (event) messages.emit(event)
        }
        if (msgs.length === 0 && pollIdleMs > 0) await sleep(pollIdleMs, signal)
      } catch (err) {
        if (signal.aborted) break
        if (isSessionExpiredError(err)) {
          log('error', 'ilink session expired; login required')
          session = undefined
          store.clear()
          setState('needs_login', '微信连接已过期，请重新扫码')
          return
        }
        failures += 1
        const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS)
        log('warn', `getupdates failed; retry in ${delay}ms`, errorMessage(err))
        setState('connected', `连接不稳定，${Math.round(delay / 1000)} 秒后重试`)
        await sleep(delay, signal)
      }
    }
  }

  function startLoop(): void {
    if (loopAbort) return
    const abort = new AbortController()
    loopAbort = abort
    loopDone = runLoop(abort.signal)
      .catch((err) => log('error', 'ilink loop crashed', errorMessage(err)))
      .finally(() => {
        if (loopAbort === abort) loopAbort = undefined
      })
  }

  async function stopLoop(): Promise<void> {
    loopAbort?.abort()
    loopAbort = undefined
    await loopDone
  }

  // ── login ────────────────────────────────────────────────────────────────────────────────────
  async function login(signal: AbortSignal): Promise<boolean> {
    let qr = await client.fetchQrcode()
    qrEvents.emit(await renderQr(qr.qrcodeContent))
    setState('connecting', '请用微信扫码')
    const deadline = now() + qrDeadlineMs
    let refreshes = 0
    while (!signal.aborted && now() < deadline) {
      let status
      try {
        status = await client.fetchQrcodeStatus(qr.qrcode)
      } catch (err) {
        log('warn', 'qr status poll failed', errorMessage(err))
        await sleep(qrPollMs, signal)
        continue
      }
      if (signal.aborted) return false
      if (status.status === 'expired') {
        refreshes += 1
        if (refreshes > QR_MAX_REFRESH) throw new Error('二维码多次过期，请重试')
        qr = await client.fetchQrcode()
        qrEvents.emit(await renderQr(qr.qrcodeContent))
      } else if (status.status === 'scaned') {
        setState('connecting', '已扫码，请在手机上确认')
      } else if (status.status === 'confirmed') {
        session = {
          token: status.bot_token ?? '',
          baseUrl: status.baseurl || ILINK_BASE_URL,
          botId: status.ilink_bot_id ?? '',
          userId: status.ilink_user_id ?? '',
        }
        if (!session.token) throw new Error('登录响应缺少 bot_token')
        store.save(session, { getUpdatesBuf: '' })
        return true
      }
      await sleep(qrPollMs, signal)
    }
    if (signal.aborted) return false
    throw new Error('扫码超时，请重试')
  }

  // ── outbound ─────────────────────────────────────────────────────────────────────────────────
  const pause = async (index: number): Promise<void> => {
    if (index === 0) return
    const [min, max] = bubblePause
    if (max <= 0) return
    await sleep(Math.round(min + Math.random() * Math.max(0, max - min)))
  }

  /** Allow-list gate for every local file that would be uploaded; throws with a user-facing reason. */
  const allowedPath = (filePath: string): string => {
    const verdict = checkOutboundMedia(filePath, allowedMediaRoots)
    if (!verdict.ok) throw new Error(verdict.error)
    return verdict.path
  }

  async function sendPart(current: IlinkSession, to: string, part: OutboundPart, contextToken: string | undefined): Promise<string | undefined> {
    switch (part.type) {
      case 'text': {
        const bubbles = splitExplicitBubbles(part.text).flatMap((b) => chunkText(b, ILINK_MAX_TEXT_LENGTH))
        let last: string | undefined
        for (const [i, bubble] of bubbles.entries()) {
          await pause(i)
          last = (await client.sendText(current, to, bubble, contextToken)).clientId
        }
        return last
      }
      case 'image':
        return (await client.sendImage(current, to, allowedPath(part.path), contextToken)).clientId
      case 'file':
        return (await client.sendFile(current, to, allowedPath(part.path), contextToken)).clientId
      case 'voice':
        return (await client.sendVoice(current, to, allowedPath(part.path), { playtimeMs: part.durationMs ?? 1000, contextToken })).clientId
      case 'sticker':
        throw new Error('iLink 通道不支持发送表情')
      default:
        throw new Error('不支持的消息类型')
    }
  }

  const adapter: IlinkAdapter = {
    channel: 'wechat-ilink',
    capabilities: { typing: true, media: ['text', 'image', 'file', 'voice'], splitsLongMessages: false, maxTextLength: ILINK_MAX_TEXT_LENGTH },
    mentionPatterns: opts.mentionPatterns,
    get state() {
      return state
    },
    get session() {
      return session
    },
    get lastError() {
      return lastError
    },
    onMessage: (handler) => messages.on((e) => void handler(e)),
    onStateChange: (handler) => states.on(({ state: s, detail }) => handler(s, detail)),
    onQr: (handler) => qrEvents.on(handler),

    async connect() {
      if (loopAbort) return
      adapter.cancelLogin()
      lastError = undefined
      if (!session) {
        const abort = new AbortController()
        loginAbort = abort
        try {
          const ok = await login(abort.signal)
          if (!ok) {
            setState('needs_login')
            return
          }
        } catch (err) {
          const message = errorMessage(err)
          setState('error', message)
          throw err
        } finally {
          if (loginAbort === abort) loginAbort = undefined
        }
      }
      setState('connected')
      startLoop()
    },

    cancelLogin() {
      if (!loginAbort) return
      loginAbort.abort()
      loginAbort = undefined
      if (state === 'connecting') setState(session ? 'disconnected' : 'needs_login')
    },

    async disconnect() {
      adapter.cancelLogin()
      await stopLoop()
      const current = session
      if (current) {
        try {
          await client.notifyStop(current)
        } catch {
          /* offline notice is best effort */
        }
      }
      setState(session ? 'disconnected' : 'needs_login')
    },

    async logout() {
      await adapter.disconnect()
      session = undefined
      store.clear()
      lastContextToken.clear()
      typingTickets.clear()
      setState('needs_login')
    },

    async send(req: SendRequest): Promise<SendResult> {
      const current = session
      if (!current) return { ok: false, error: '微信机器人未登录' }
      if (req.to.channel !== 'wechat-ilink') return { ok: false, error: `通道不匹配：${req.to.channel}` }
      const to = req.to.chatId || req.to.peerId
      if (!to) return { ok: false, error: '缺少接收方' }
      const contextToken = req.contextToken ?? lastContextToken.get(to)
      try {
        let messageId: string | undefined
        for (const part of req.parts) {
          const id = await sendPart(current, to, part, contextToken)
          if (id) messageId = id
        }
        return { ok: true, messageId }
      } catch (err) {
        if (isSessionExpiredError(err)) {
          session = undefined
          store.clear()
          await stopLoop()
          setState('needs_login', '微信连接已过期，请重新扫码')
        }
        return { ok: false, error: errorMessage(err) }
      }
    },

    async sendTyping(to) {
      const current = session
      if (!current) return
      const userId = to.chatId || to.peerId
      try {
        let ticket = typingTickets.get(userId)
        if (!ticket) {
          const cfg = await client.getConfig(current, userId, lastContextToken.get(userId))
          ticket = cfg?.typing_ticket ?? ''
          if (!ticket) return
          typingTickets.set(userId, ticket)
        }
        await client.sendTyping(current, userId, ticket, 1)
      } catch (err) {
        typingTickets.delete(userId)
        log('debug', 'sendtyping failed', errorMessage(err))
      }
    },
  }

  return adapter
}
