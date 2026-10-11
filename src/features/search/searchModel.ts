/**
 * Pure logic of 搜索聊天记录 (DESIGN-SPEC「全局搜索」): the tab state and what `tab.openSearch` does to it, the time
 * range → substrate bounds, the SearchQuery itself, paging, grouping hits by chat and 最近搜索. Snippet parsing lives
 * in snippetModel.ts. No React, no bridge — tested in searchModel.test.ts.
 */
import type { ConnectionState, SearchHit, SearchQuery, WxMessage } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'
import { formatDateDivider, startOfDay } from '@/platform/format'
import { charCount } from './snippetModel'

/** objectId of the one search tab. */
export const SEARCH_OBJECT_ID = 'search'
/** Live search starts at this many characters; Enter searches anything that is not blank. */
export const MIN_LIVE_CHARS = 2
/** Pause after the last keystroke before a live search runs. */
export const LIVE_DEBOUNCE_MS = 250
/** First page of hits; 加载更多 asks again for this many more. */
export const PAGE_SIZE = 100
/** Hard cap on one result list: past it, a narrower search is the answer, not more paging. */
export const MAX_RESULTS = 500
/** 最近搜索 kept per viewer. */
export const RECENT_MAX = 20

const DAY_MS = 86_400_000

export type RangePreset = 'all' | '7d' | '30d' | '1y'
/** `custom` only arrives with a `tab.openSearch` that carries bounds (ms, inclusive); the picker offers presets. */
export type SearchRange = { preset: RangePreset } | { preset: 'custom'; from?: number; to?: number }

export const RANGE_PRESETS: ReadonlyArray<{ value: RangePreset; labelKey: MessageKey }> = [
  { value: 'all', labelKey: 'search.range.all' },
  { value: '7d', labelKey: 'search.range.days7' },
  { value: '30d', labelKey: 'search.range.days30' },
  { value: '1y', labelKey: 'search.range.year' },
]

/** What `tab.state` holds (a type, not an interface, so it is a plain `Record<string, unknown>` for the tab store). */
export type SearchTabState = {
  /** The committed query: what the results answer (the box may hold a newer draft). */
  query: string
  /** Chats to search; empty = every chat. */
  sessionIds: string[]
  range: SearchRange
  /** Bumped by every `tab.openSearch` (and a recent-search pick): the header remounts with the query and takes focus. */
  request: number
}

export const DEFAULT_SEARCH_STATE: SearchTabState = { query: '', sessionIds: [], range: { preset: 'all' }, request: 0 }

/** The `tab.openSearch` payload after validation (it also arrives untyped from the native menu). */
export interface OpenSearchRequest {
  query?: string
  sessionIds?: string[]
  from?: number
  to?: number
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return [...new Set(ids)]
}

function parseRange(raw: unknown): SearchRange {
  if (!raw || typeof raw !== 'object') return { preset: 'all' }
  const r = raw as { preset?: unknown; from?: unknown; to?: unknown }
  if (r.preset === 'custom') {
    const from = isFiniteNumber(r.from) ? r.from : undefined
    const to = isFiniteNumber(r.to) ? r.to : undefined
    return from === undefined && to === undefined ? { preset: 'all' } : { preset: 'custom', from, to }
  }
  const preset = RANGE_PRESETS.find((p) => p.value === r.preset)?.value
  return { preset: preset ?? 'all' }
}

/** Validate whatever sits in `tab.state`; anything malformed falls back to the default. */
export function parseSearchState(raw: unknown): SearchTabState {
  if (!raw || typeof raw !== 'object') return DEFAULT_SEARCH_STATE
  const s = raw as Record<string, unknown>
  return {
    query: typeof s.query === 'string' ? s.query.trim() : '',
    sessionIds: idList(s.sessionIds),
    range: parseRange(s.range),
    request: isFiniteNumber(s.request) ? s.request : 0,
  }
}

/** Keep only well-formed fields of a `tab.openSearch` payload. */
export function parseOpenRequest(raw: unknown): OpenSearchRequest {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: OpenSearchRequest = {}
  if (typeof r.query === 'string') out.query = r.query.trim()
  if (Array.isArray(r.sessionIds)) out.sessionIds = idList(r.sessionIds)
  if (isFiniteNumber(r.from)) out.from = r.from
  if (isFiniteNumber(r.to)) out.to = r.to
  return out
}

/**
 * What `tab.openSearch` does to the tab. A bare request (⇧⌘F, the menu) keeps the search and only refocuses the box;
 * a request with any field starts a new search: its query (or the current one), its chats (default all) and its time
 * bounds (default any time).
 */
export function applyOpenRequest(prev: SearchTabState, req: OpenSearchRequest): SearchTabState {
  const request = prev.request + 1
  const bare = req.query === undefined && req.sessionIds === undefined && req.from === undefined && req.to === undefined
  if (bare) return { ...prev, request }
  const bounded = req.from !== undefined || req.to !== undefined
  return {
    query: req.query ?? prev.query,
    sessionIds: req.sessionIds ?? [],
    range: bounded ? { preset: 'custom', from: req.from, to: req.to } : { preset: 'all' },
    request,
  }
}

/** The chats or the time range narrow the search (no-results then offers 清除筛选). */
export function hasFilters(state: Pick<SearchTabState, 'sessionIds' | 'range'>): boolean {
  return state.sessionIds.length > 0 || state.range.preset !== 'all'
}

/** Inclusive bounds (ms) for a range. Presets count calendar days including today, like the chat tab's date filter. */
export function rangeBounds(range: SearchRange, now: number): { from?: number; to?: number } {
  switch (range.preset) {
    case 'all':
      return {}
    case '7d':
      return { from: startOfDay(now) - 6 * DAY_MS }
    case '30d':
      return { from: startOfDay(now) - 29 * DAY_MS }
    case '1y':
      return { from: startOfDay(now) - 364 * DAY_MS }
    case 'custom': {
      const { from, to } = range
      if (from !== undefined && to !== undefined && from > to) return { from: to, to: from }
      return { from, to }
    }
  }
}

/** Label of a range in the picker; a custom one names its days. */
export function rangeLabel(range: SearchRange, now: number = Date.now()): string {
  if (range.preset !== 'custom') {
    const key = RANGE_PRESETS.find((p) => p.value === range.preset)?.labelKey ?? 'search.range.all'
    return t(key)
  }
  const { from, to } = rangeBounds(range, now)
  const day = (ms: number) => formatDateDivider(ms, now)
  if (from !== undefined && to !== undefined) return t('search.range.custom', { from: day(from), to: day(to) })
  if (from !== undefined) return t('search.range.since', { from: day(from) })
  if (to !== undefined) return t('search.range.until', { to: day(to) })
  return t('search.range.all')
}

/** The request the tab sends. Keyword mode only: it reads the local index and never calls an embedding model. */
export function toSearchQuery(
  req: { query: string; sessionIds: readonly string[]; range: SearchRange },
  limit: number,
  now: number,
): SearchQuery {
  const { from, to } = rangeBounds(req.range, now)
  return {
    query: req.query.trim(),
    ...(req.sessionIds.length > 0 ? { sessionIds: [...req.sessionIds] } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    limit,
    mode: 'keyword',
    match: 'exact',
  }
}

/** 加载更多: the substrate ranks by relevance and cuts at `limit`, so a bigger page is the next page. */
export function nextLimit(limit: number): number {
  return Math.min(MAX_RESULTS, limit + PAGE_SIZE)
}

/** A full page may hide more hits; a short one is everything there is. Nothing more past the cap. */
export function hasMoreResults(count: number, limit: number): boolean {
  return count >= limit && limit < MAX_RESULTS
}

/**
 * What a pause in typing commits: the draft once it is long enough; '' (back to the start page) when the box was
 * emptied or cut below that; nothing when the draft already is the committed query.
 */
export function liveCommit(draft: string, committed: string): string | undefined {
  const query = draft.trim()
  if (query === committed) return undefined
  if (charCount(query) >= MIN_LIVE_CHARS) return query
  return committed === '' ? undefined : ''
}

export type SearchGate = 'ready' | 'waiting' | 'not_connected'

/**
 * Whether the tab can search, from the substrate's connection state — never from an error text (AGENTS.md §2.5).
 * An unknown state (the status call itself failed) tries anyway and lets a failure show as the error state.
 */
export function searchGate(connection: ConnectionState | undefined, statusPending: boolean): SearchGate {
  switch (connection) {
    case 'ready':
      return 'ready'
    case 'connecting':
      return 'waiting'
    case 'no_config':
    case 'locked':
    case 'error':
      return 'not_connected'
    case undefined:
      return statusPending ? 'waiting' : 'ready'
  }
}

/* ------------------------------------------------------------------------------------------------ results */

export interface HitGroup {
  sessionId: string
  hits: SearchHit[]
}

/**
 * Hits by chat. Chats keep the substrate's order (best match first); inside a chat the messages run newest first,
 * the way WeChat lists the matches of one chat. A message listed twice is shown once.
 */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const groups = new Map<string, SearchHit[]>()
  const seen = new Set<string>()
  for (const hit of hits) {
    const { sessionId, id } = hit.message
    const key = `${sessionId}\n${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const list = groups.get(sessionId)
    if (list) list.push(hit)
    else groups.set(sessionId, [hit])
  }
  return [...groups].map(([sessionId, list]) => ({
    sessionId,
    hits: list.sort((a, b) => b.message.createdAt - a.message.createdAt || b.message.seq - a.message.seq),
  }))
}

export type ResultRow =
  | { kind: 'group'; key: string; sessionId: string; count: number; first: boolean }
  | { kind: 'hit'; key: string; hit: SearchHit }
  /** The list foot: 加载更多, the cap notice or a failed 加载更多. */
  | { kind: 'end'; key: string }

/** Flat rows for the virtual list: each chat's header, then its hits. */
export function resultRows(groups: readonly HitGroup[], withEnd: boolean): ResultRow[] {
  const rows: ResultRow[] = []
  groups.forEach((group, i) => {
    rows.push({
      kind: 'group',
      key: `group:${group.sessionId}`,
      sessionId: group.sessionId,
      count: group.hits.length,
      first: i === 0,
    })
    for (const hit of group.hits) rows.push({ kind: 'hit', key: `hit:${group.sessionId}:${hit.message.id}`, hit })
  })
  if (withEnd) rows.push({ kind: 'end', key: 'end' })
  return rows
}

/** Who sent a hit: 我 for my own messages, the stored name, else (a direct chat) the chat itself. */
export function senderLabel(
  message: Pick<WxMessage, 'isSelf' | 'senderName' | 'senderId'>,
  opts: { me: string; direct: boolean; chatTitle?: string },
): string {
  if (message.isSelf) return opts.me
  const name = message.senderName?.trim()
  if (name) return name
  if (opts.direct && opts.chatTitle) return opts.chatTitle
  return message.senderId
}

/* ---------------------------------------------------------------------------------------- recent searches */

/** Newest first, no repeats, at most RECENT_MAX. */
export function pushRecent(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!q) return [...list]
  return [q, ...list.filter((x) => x !== q)].slice(0, RECENT_MAX)
}

/** Validate a stored list (it comes back from localStorage as anything). */
export function parseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const items = raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim())
  return [...new Set(items.filter(Boolean))].slice(0, RECENT_MAX)
}
