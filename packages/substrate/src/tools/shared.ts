/**
 * Shared helpers for the WeChat substrate tools: compact output shaping (messages / anchors /
 * sessions / contacts), local time formatting, limit clamping, coverage description and uniform
 * ToolResult construction. Tools never touch WeChat files or SQLite directly — everything goes
 * through the injected SubstrateService, so the same tools work against WCDB, the mirror or fixtures.
 */
import { defineTool, formatCitation } from '@aiwc/protocol'
import type {
  JsonValue,
  MessageAnchor,
  MessageKind,
  Millis,
  SearchHit,
  SubstrateService,
  SyncPhase,
  ToolDefinition,
  ToolProfile,
  ToolResult,
  WxContact,
  WxMedia,
  WxMessage,
  WxSession,
} from '@aiwc/protocol'
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Tool typing
// ---------------------------------------------------------------------------------------------

/** Services every substrate tool needs. Kept as a type alias so it satisfies ToolServices' index signature. */
export type SubstrateToolServices = { substrate: SubstrateService }
export type SubstrateTool<I = unknown> = ToolDefinition<I, SubstrateToolServices>

export function defineSubstrateTool<I>(def: SubstrateTool<I>): SubstrateTool<I> {
  return defineTool<I, SubstrateToolServices>(def)
}

/**
 * Read-only WeChat tools that can be confined to one session are mounted on every profile that may
 * read data. Under 'wechat-bot' they must scope every read to ctx.origin.chatId (see botScope.ts).
 */
export const READ_PROFILES: readonly ToolProfile[] = ['desktop-chat', 'wechat-bot', 'cron', 'subagent']

/**
 * Tools that enumerate the owner's contact graph or scan across sessions (list_sessions,
 * list_contacts, list_groups, search_media): never mounted on the bot, whose replies are auto-sent
 * to the peer.
 */
export const READ_PROFILES_NO_BOT: readonly ToolProfile[] = ['desktop-chat', 'cron', 'subagent']

// ---------------------------------------------------------------------------------------------
// Limits, text, time
// ---------------------------------------------------------------------------------------------

export const MAX_TEXT_CHARS = 200
export const MAX_QUOTE_CHARS = 80
export const MAX_SNIPPET_CHARS = 200

/** Clamp a caller-provided limit into [min, max], falling back to `def` for missing / invalid values. */
export function clampLimit(value: number | undefined | null, def: number, max: number, min = 1): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : def
  return Math.min(max, Math.max(min, n))
}

/** Collapse whitespace and cut to `max` characters (adds an ellipsis when cut). */
export function squash(text: string | undefined | null, max: number): string {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

/** Local-time `YYYY-MM-DD HH:mm` for citing evidence; null for missing / invalid timestamps. */
export function fmtTime(ms: Millis | undefined | null): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

// ---------------------------------------------------------------------------------------------
// Schemas shared by several tools
// ---------------------------------------------------------------------------------------------

export const MessageAnchorSchema = z.object({
  sessionId: z.string().trim().min(1).describe('会话 id（anchor.sessionId 原样填）'),
  messageId: z.string().trim().min(1).describe('消息 id（anchor.messageId 原样填）'),
  seq: z.number().int().describe('会话内排序键（anchor.seq 原样填）'),
  createdAt: z.number().int().nonnegative().describe('毫秒时间戳（anchor.createdAt 原样填）'),
})

export const TimeRangeRefinement = {
  check: (v: { from?: number; to?: number }) => v.from === undefined || v.to === undefined || v.from <= v.to,
  message: 'from 必须小于等于 to',
} as const

const DATE_INPUT = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * A time bound as the model naturally writes it. Numbers are epoch milliseconds (the original
 * contract); strings may be a local date / date-time / month, or a numeric timestamp. Asking a model
 * to convert "2 月 14 日" into epoch milliseconds itself was a steady source of wrong windows and
 * therefore of "no evidence found". `edge` decides how a coarse value widens: 'start' → first
 * millisecond of that day / minute / month, 'end' → last millisecond (so `to: "2026-02-14"` includes
 * the whole day). Returns undefined for anything unrecognisable or impossible (2026-02-30).
 */
export function parseTimeInput(value: number | string, edge: 'start' | 'end'): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
  const text = value.trim()
  if (/^\d{10}$/.test(text)) return Number(text) * 1000
  if (/^\d{12,16}$/.test(text)) return Number(text)
  const m = DATE_INPUT.exec(text)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = m[3] === undefined ? undefined : Number(m[3])
  const hour = m[4] === undefined ? undefined : Number(m[4])
  const minute = m[5] === undefined ? undefined : Number(m[5])
  const second = m[6] === undefined ? undefined : Number(m[6])
  if (month < 1 || month > 12) return undefined
  if (day === undefined) {
    if (hour !== undefined) return undefined
    return edge === 'start' ? new Date(year, month - 1, 1).getTime() : new Date(year, month, 1).getTime() - 1
  }
  if ((hour ?? 0) > 23 || (minute ?? 0) > 59 || (second ?? 0) > 59) return undefined
  const at = new Date(year, month - 1, day, hour ?? 0, minute ?? 0, second ?? 0, 0)
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return undefined
  if (edge === 'start') return at.getTime()
  if (hour === undefined) return new Date(year, month - 1, day + 1).getTime() - 1
  return at.getTime() + (second === undefined ? 59_999 : 999)
}

const TIME_FORMAT_ERROR =
  '时间格式无法识别：请写「2026-02-14」「2026-02-14 19:28」或「2026-02」（本地时间），也可以给毫秒时间戳'

function timeBound(edge: 'start' | 'end', description: string) {
  return z
    .union([z.number().int().nonnegative(), z.string().trim().min(1)])
    .transform((value, ctx) => {
      const ms = parseTimeInput(value, edge)
      if (ms === undefined) {
        ctx.addIssue({ code: 'custom', message: TIME_FORMAT_ERROR })
        return z.NEVER
      }
      return ms
    })
    .describe(description)
}

/** Inclusive lower bound: 「2026-02-14」 = from 00:00 that day. */
export const timeFrom = (
  description = '起始时间（含）：「2026-02-14」「2026-02-14 19:28」「2026-02」按本地时间理解，也可以给毫秒时间戳',
) => timeBound('start', description)
/** Inclusive upper bound: 「2026-02-14」 = through 23:59:59 that day, 「2026-02」 = through the month's end. */
export const timeTo = (
  description = '结束时间（含）：只写日期表示到当天结束，只写月份表示到月底；也可以给毫秒时间戳',
) => timeBound('end', description)

// ---------------------------------------------------------------------------------------------
// Compact shapes
// ---------------------------------------------------------------------------------------------

export interface CompactMessage {
  anchor: MessageAnchor
  /** Paste-ready citation link for this message (see protocol formatCitation). */
  cite: string
  time: string | null
  senderName: string
  isSelf: boolean
  kind: MessageKind
  text: string
  quote?: { senderName?: string; text: string }
  media?: { kind: WxMedia['kind']; fileName?: string; durationMs?: number; sizeBytes?: number; hasTranscript?: boolean }
}

export function anchorOf(m: WxMessage): MessageAnchor {
  const a = m.anchor
  if (a && a.sessionId && a.messageId)
    return { sessionId: a.sessionId, messageId: a.messageId, seq: a.seq, createdAt: a.createdAt }
  return { sessionId: m.sessionId, messageId: m.id, seq: m.seq, createdAt: m.createdAt }
}

/** `[MM-DD HH:mm](wx://session/message)` — short label, full ids; the UI resolves the rest. */
export function citeOf(anchor: MessageAnchor): string {
  const time = fmtTime(anchor.createdAt)
  return formatCitation(anchor, time ? time.slice(5) : '消息')
}

export function displaySender(m: Pick<WxMessage, 'isSelf' | 'senderName' | 'senderId'>): string {
  if (m.isSelf) return '我'
  const name = m.senderName?.trim()
  return name || m.senderId || '未知'
}

function withPrefix(prefix: string, body: string, max: number): string {
  return body ? squash(`${prefix} ${body}`, max) : prefix
}

/** Model-facing text for a message: raw text for text kinds, a short placeholder for media / system kinds. */
export function messageText(m: WxMessage, max = MAX_TEXT_CHARS): string {
  const base = squash(m.text, max)
  const media = m.media
  switch (m.kind) {
    case 'text':
    case 'quote':
      return base
    case 'image':
      return base || '[图片]'
    case 'voice': {
      const transcript = squash(media?.transcript, max)
      if (transcript) return withPrefix('[语音]', transcript, max)
      const secs = media?.durationMs ? ` ${Math.max(1, Math.round(media.durationMs / 1000))}s` : ''
      return `[语音${secs}]`
    }
    case 'video':
      return base || '[视频]'
    case 'file':
      return withPrefix('[文件]', squash(media?.fileName, max) || base, max)
    case 'sticker':
      return '[表情]'
    case 'link':
      return withPrefix('[链接]', base, max)
    case 'card':
      return withPrefix('[名片]', base, max)
    case 'location':
      return withPrefix('[位置]', base, max)
    case 'transfer':
      return withPrefix('[转账]', base, max)
    case 'system':
      return base || '[系统消息]'
    case 'revoke':
      return base || '[消息已撤回]'
    default:
      return base || `[${m.kind}]`
  }
}

/** Compact, bounded, anchor-carrying view of a message. Never includes media paths or bytes. */
export function compactMessage(m: WxMessage): CompactMessage {
  const anchor = anchorOf(m)
  const out: CompactMessage = {
    anchor,
    cite: citeOf(anchor),
    time: fmtTime(m.createdAt),
    senderName: displaySender(m),
    isSelf: m.isSelf,
    kind: m.kind,
    text: messageText(m),
  }
  if (m.quote) {
    out.quote = { text: squash(m.quote.text, MAX_QUOTE_CHARS) }
    if (m.quote.senderName) out.quote.senderName = m.quote.senderName
  }
  if (m.media) {
    out.media = { kind: m.media.kind }
    if (m.media.fileName) out.media.fileName = m.media.fileName
    if (typeof m.media.durationMs === 'number') out.media.durationMs = m.media.durationMs
    if (typeof m.media.sizeBytes === 'number') out.media.sizeBytes = m.media.sizeBytes
    if (m.media.transcript) out.media.hasTranscript = true
  }
  return out
}

/**
 * Sender names are frozen into the index when a message is first seen; a contact added or renamed
 * later, or a group member with no cached name, comes back as a raw wxid. Fill those in from the
 * contact book once per tool call (cached), so the model never has to guess who "wxid_x9k…" is.
 */
export function createNameResolver(substrate: Pick<SubstrateService, 'getContact' | 'getSession'>) {
  const contacts = new Map<string, Promise<string | undefined>>()
  const sessions = new Map<string, Promise<string | undefined>>()
  const contact = (id: string): Promise<string | undefined> => {
    let job = contacts.get(id)
    if (!job) {
      job = substrate
        .getContact(id)
        .then((c) => c?.remark?.trim() || c?.nickname?.trim() || undefined)
        .catch(() => undefined)
      contacts.set(id, job)
    }
    return job
  }
  const session = (id: string): Promise<string | undefined> => {
    let job = sessions.get(id)
    if (!job) {
      job = substrate
        .getSession(id)
        .then((sess) => sess?.title?.trim() || undefined)
        .catch(() => undefined)
      sessions.set(id, job)
    }
    return job
  }
  const looksUnresolved = (m: WxMessage): boolean =>
    !m.isSelf && !!m.senderId && (!m.senderName?.trim() || m.senderName.trim() === m.senderId)
  /** Messages with their sender names filled from the contact book where the index had none. */
  const withSenderNames = async (messages: readonly WxMessage[]): Promise<WxMessage[]> => {
    const out = await Promise.all(
      messages.map(async (m) => {
        if (!looksUnresolved(m)) return m
        const name = await contact(m.senderId)
        return name ? { ...m, senderName: name } : m
      }),
    )
    return out
  }
  return { contact, session, withSenderNames }
}

/** Ascending by seq, then createdAt, then id — the canonical reading order. */
export function sortBySeq(items: readonly WxMessage[]): WxMessage[] {
  return [...items].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** Drop duplicate messages (same session + id), keeping the first occurrence. */
export function dedupeMessages(items: readonly WxMessage[]): WxMessage[] {
  const seen = new Set<string>()
  const out: WxMessage[] = []
  for (const m of items) {
    const key = `${m.sessionId}:${m.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

export interface CompactSession {
  id: string
  kind: WxSession['kind']
  title: string
  lastMessageAt: Millis | null
  time: string | null
  unread: number
  memberCount?: number
}

export function compactSession(s: WxSession): CompactSession {
  const out: CompactSession = {
    id: s.id,
    kind: s.kind,
    title: s.title,
    lastMessageAt: typeof s.lastMessageAt === 'number' ? s.lastMessageAt : null,
    time: fmtTime(s.lastMessageAt),
    unread: s.unread,
  }
  if (typeof s.memberCount === 'number') out.memberCount = s.memberCount
  return out
}

export interface CompactContact {
  username: string
  nickname: string
  remark?: string
  kind: WxContact['kind']
}

export function compactContact(c: WxContact): CompactContact {
  const out: CompactContact = { username: c.username, nickname: c.nickname, kind: c.kind }
  if (c.remark) out.remark = c.remark
  return out
}

export interface CompactHit {
  anchor: MessageAnchor
  cite: string
  time: string | null
  /** Title of the chat the hit came from — a global search otherwise only shows raw ids. */
  chat?: string
  sender: string
  isSelf: boolean
  kind: MessageKind
  snippet: string
  score: number
  source: SearchHit['source']
}

export function compactHit(h: SearchHit): CompactHit {
  const m = h.message
  const anchor = anchorOf(m)
  return {
    anchor,
    cite: citeOf(anchor),
    time: fmtTime(m.createdAt),
    sender: displaySender(m),
    isSelf: m.isSelf,
    kind: m.kind,
    snippet: squash(h.snippet, MAX_SNIPPET_CHARS) || messageText(m, MAX_SNIPPET_CHARS),
    score: round(Number.isFinite(h.score) ? h.score : 0),
    source: h.source,
  }
}

// ---------------------------------------------------------------------------------------------
// Coverage — every search-like tool tells the model what was (and was not) searched
// ---------------------------------------------------------------------------------------------

export interface Coverage {
  scope: 'sessions' | 'all_indexed' | 'recent_sessions'
  sessionIds?: string[]
  sessionCount?: number
  from?: string | null
  to?: string | null
  indexedMessages?: number
  lastSyncedAt?: string | null
  syncPhase: SyncPhase
  /** true when the result may be incomplete (global scan bounded by the local index). */
  bounded: boolean
  note: string
}

export function describeCoverage(
  substrate: SubstrateService,
  opts: {
    sessionIds?: readonly string[]
    from?: Millis
    to?: Millis
    scope?: Coverage['scope']
    sessionCount?: number
  },
): Coverage {
  let phase: SyncPhase = 'idle'
  let indexed: number | undefined
  let lastSyncedAt: Millis | undefined
  try {
    const st = substrate.status()
    phase = st.sync.phase
    indexed = st.sync.totals?.messages
    lastSyncedAt = st.sync.lastSyncedAt
  } catch {
    /* status is best-effort */
  }
  const scope: Coverage['scope'] =
    opts.scope ?? (opts.sessionIds && opts.sessionIds.length > 0 ? 'sessions' : 'all_indexed')
  const out: Coverage = { scope, syncPhase: phase, bounded: scope !== 'sessions', note: '' }
  if (opts.sessionIds && opts.sessionIds.length > 0) {
    out.sessionIds = [...opts.sessionIds]
    out.sessionCount = opts.sessionIds.length
  } else if (typeof opts.sessionCount === 'number') {
    out.sessionCount = opts.sessionCount
  }
  if (opts.from !== undefined) out.from = fmtTime(opts.from)
  if (opts.to !== undefined) out.to = fmtTime(opts.to)
  if (typeof indexed === 'number') out.indexedMessages = indexed
  out.lastSyncedAt = fmtTime(lastSyncedAt)

  const syncHint =
    phase === 'syncing'
      ? '本地索引仍在同步中，结果可能不完整。'
      : phase === 'error'
        ? '上次同步失败，索引可能过旧。'
        : ''
  if (scope === 'sessions') {
    out.note = `仅搜索指定的 ${out.sessionCount} 个会话中已同步到本地索引的消息。${syncHint}`.trim()
  } else if (scope === 'recent_sessions') {
    out.note =
      `只扫描了最近活跃的 ${out.sessionCount ?? 0} 个会话，且每个会话只取最近一段；更早或不活跃的会话不在范围内。${syncHint}`.trim()
  } else {
    const count = typeof indexed === 'number' ? `约 ${indexed} 条` : '数量未知'
    out.note =
      `全局搜索只覆盖已同步到本地索引的消息（${count}）；结果可能不完整，建议用 sessionIds 限定范围。${syncHint}`.trim()
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** JSON round-trip: strips undefined, guarantees the value is a JsonValue. */
export function toJson(value: unknown): JsonValue {
  const text = JSON.stringify(value ?? null, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))
  return JSON.parse(text ?? 'null') as JsonValue
}

export function ok(content: unknown, meta?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: toJson(content) }
  if (meta) result.meta = toJson(meta) as Record<string, JsonValue>
  return result
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
  return { content: toJson({ error: message, ...(extra ?? {}) }), isError: true }
}

/** UI-facing evidence anchors (never sent to the model — see ToolResult.meta). */
export function anchorsMeta(anchors: readonly MessageAnchor[]): Record<string, unknown> {
  return {
    anchors: anchors.map((a) => ({
      sessionId: a.sessionId,
      messageId: a.messageId,
      seq: a.seq,
      createdAt: a.createdAt,
    })),
  }
}

function readableMessage(error: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  if (typeof error === 'object') {
    const rec = error as Record<string, unknown>
    if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim()
    if (typeof rec.error === 'string' && rec.error.trim()) return rec.error.trim()
  }
  const text = String(error).trim()
  return text && text !== '[object Object]' ? text : ''
}

export function describeToolError(error: unknown, fallback: string): string {
  const head = readableMessage(error) || fallback
  const cause = error && typeof error === 'object' ? readableMessage((error as { cause?: unknown }).cause) : ''
  return cause && cause !== head ? `${head} | cause=${squash(cause, 300)}` : head
}

export function isAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
}

export const ABORTED_MESSAGE = '已取消'
