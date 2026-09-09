/**
 * Shared helpers for the WeChat substrate tools: compact output shaping (messages / anchors /
 * sessions / contacts), local time formatting, limit clamping, coverage description and uniform
 * ToolResult construction. Tools never touch WeChat files or SQLite directly — everything goes
 * through the injected SubstrateService, so the same tools work against WCDB, the mirror or fixtures.
 */
import { defineTool } from '@aiwc/protocol'
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
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
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

// ---------------------------------------------------------------------------------------------
// Compact shapes
// ---------------------------------------------------------------------------------------------

export interface CompactMessage {
  anchor: MessageAnchor
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
  if (a && a.sessionId && a.messageId) return { sessionId: a.sessionId, messageId: a.messageId, seq: a.seq, createdAt: a.createdAt }
  return { sessionId: m.sessionId, messageId: m.id, seq: m.seq, createdAt: m.createdAt }
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
  const out: CompactMessage = {
    anchor: anchorOf(m),
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
  time: string | null
  sender: string
  isSelf: boolean
  kind: MessageKind
  snippet: string
  score: number
  source: SearchHit['source']
}

export function compactHit(h: SearchHit): CompactHit {
  const m = h.message
  return {
    anchor: anchorOf(m),
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
  opts: { sessionIds?: readonly string[]; from?: Millis; to?: Millis; scope?: Coverage['scope']; sessionCount?: number },
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
  const scope: Coverage['scope'] = opts.scope ?? (opts.sessionIds && opts.sessionIds.length > 0 ? 'sessions' : 'all_indexed')
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

  const syncHint = phase === 'syncing' ? '本地索引仍在同步中，结果可能不完整。' : phase === 'error' ? '上次同步失败，索引可能过旧。' : ''
  if (scope === 'sessions') {
    out.note = `仅搜索指定的 ${out.sessionCount} 个会话中已同步到本地索引的消息。${syncHint}`.trim()
  } else if (scope === 'recent_sessions') {
    out.note = `只扫描了最近活跃的 ${out.sessionCount ?? 0} 个会话，且每个会话只取最近一段；更早或不活跃的会话不在范围内。${syncHint}`.trim()
  } else {
    const count = typeof indexed === 'number' ? `约 ${indexed} 条` : '数量未知'
    out.note = `全局搜索只覆盖已同步到本地索引的消息（${count}）；结果可能不完整，建议用 sessionIds 限定范围。${syncHint}`.trim()
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
  return { anchors: anchors.map((a) => ({ sessionId: a.sessionId, messageId: a.messageId, seq: a.seq, createdAt: a.createdAt })) }
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
