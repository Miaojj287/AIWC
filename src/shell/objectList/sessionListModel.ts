/**
 * Pure helpers for the chat-function session list (DESIGN-SPEC §1.1): segment → query kind, the
 * second line, client-side extras the substrate query cannot express, the group avatar mosaic and
 * the one MenuSpec shared by `···` and right-click. No React, no bridge — tested in
 * sessionListModel.test.ts.
 */
import { AtSign, BellOff, Bell, Bot, CheckCheck, EyeOff, Pin, PinOff, Reply } from 'lucide-react'
import type { ConnectionState, SessionKind, WxSession } from '@aiwc/protocol'
import { t, type MessageKey, type Translator } from '@/i18n'
import type { MenuSpec } from '@/kit'
import { shortcutLabel } from '@/app/shortcuts'
import type { ListFilterOption } from './listHeaderContext'

export const SESSION_SEGMENTS: ReadonlyArray<{ id: 'all' | 'dm' | 'group'; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'shell.sessions.segments.all' },
  { id: 'dm', labelKey: 'shell.sessions.segments.dm' },
  { id: 'group', labelKey: 'shell.sessions.segments.group' },
]

/** Resolved with t() by the list body before it is published to the header. */
export const SESSION_FILTER_OPTIONS: ReadonlyArray<Omit<ListFilterOption, 'label'> & { labelKey: MessageKey }> = [
  { id: 'unreadOnly', labelKey: 'shell.sessions.filters.unreadOnly' },
  { id: 'mutedOnly', labelKey: 'shell.sessions.filters.mutedOnly' },
  { id: 'hidden', labelKey: 'shell.sessions.filters.hidden' },
]

/** Page size for substrate:listSessions. */
export const SESSION_PAGE_SIZE = 60

/** Segment id (null = first) → ListSessionsQuery.kind. */
export function segmentKind(segment: string | null): SessionKind | 'all' {
  return segment === 'dm' || segment === 'group' ? segment : 'all'
}

/** Second line: groups prefix the sender (「李明：周会纪要已上传」), DMs show the preview alone. */
export function sessionSubtitle(session: Pick<WxSession, 'kind' | 'lastPreview' | 'lastSender'>): string {
  const preview = session.lastPreview?.trim() ?? ''
  const sender = session.lastSender?.trim()
  if (session.kind === 'group' && sender && preview) return t('shell.sessions.namedPreview', { name: sender, preview })
  return preview
}

/** Filters the substrate query cannot express (muted) are applied to the loaded page. */
export function applyClientFilters<T extends Pick<WxSession, 'muted'>>(
  items: readonly T[],
  filters: Record<string, boolean>,
): T[] {
  let out = [...items]
  if (filters.mutedOnly) out = out.filter((s) => s.muted)
  return out
}

export interface SessionMenuActions {
  /** Toggle local flags (pinned / muted / read) — substrate:setSessionFlags. */
  setFlags(flags: { pinned?: boolean; muted?: boolean; read?: boolean }): void
  openAutoReply(): void
  openClone(): void
  quoteToAgent(): void
  hide(): void
  unhide(): void
}

/**
 * The session menu (Figma 156:964): regular → separator → cross-feature → separator → danger last
 * (CLAUDE.md §4.2). Cloning is a per-contact feature, so it is disabled for groups.
 */
export function sessionMenuSpec(
  session: Pick<WxSession, 'kind' | 'pinned' | 'muted' | 'unread'>,
  actions: SessionMenuActions,
  opts: { mac: boolean; hidden?: boolean },
): MenuSpec {
  const items: MenuSpec = [
    {
      id: 'pin',
      label: session.pinned ? t('shell.sessions.menu.unpin') : t('shell.sessions.menu.pin'),
      icon: session.pinned ? PinOff : Pin,
      onSelect: () => actions.setFlags({ pinned: !session.pinned }),
    },
    {
      id: 'read',
      label: t('shell.sessions.menu.markRead'),
      icon: CheckCheck,
      disabled: session.unread <= 0,
      onSelect: () => actions.setFlags({ read: true }),
    },
    {
      id: 'mute',
      label: session.muted ? t('shell.sessions.menu.unmute') : t('shell.sessions.menu.mute'),
      icon: session.muted ? Bell : BellOff,
      onSelect: () => actions.setFlags({ muted: !session.muted }),
    },
    { type: 'separator' },
    { id: 'autoreply', label: t('shell.sessions.menu.autoReply'), icon: Reply, onSelect: actions.openAutoReply },
    {
      id: 'clone',
      label: t('shell.sessions.menu.clone'),
      icon: Bot,
      disabled: session.kind !== 'dm',
      description: session.kind !== 'dm' ? t('shell.sessions.menu.cloneDmOnly') : undefined,
      onSelect: actions.openClone,
    },
    {
      id: 'quote',
      label: t('shell.sessions.menu.quote'),
      icon: AtSign,
      shortcut: shortcutLabel('agent.quoteActiveTab', opts.mac),
      onSelect: actions.quoteToAgent,
    },
    { type: 'separator' },
  ]
  if (opts.hidden)
    items.push({ id: 'unhide', label: t('shell.sessions.menu.unhide'), icon: EyeOff, onSelect: actions.unhide })
  else
    items.push({ id: 'hide', label: t('shell.sessions.menu.hide'), icon: EyeOff, danger: true, onSelect: actions.hide })
  return items
}

/** What the list shows after a page failed to load: keep loading, offer to connect WeChat, or a retryable error. */
export type ListFailureView = 'waiting' | 'not_connected' | 'failed'

/**
 * Classifies a failed session page by the substrate's connection state, never by the error text: the substrate's
 * not_open error reaches the renderer as a translated message only (AGENTS.md §2.5). `statusPending` = the
 * `substrate:status` answer has not arrived yet.
 */
export function listFailureView(connection: ConnectionState | undefined, statusPending: boolean): ListFailureView {
  switch (connection) {
    case undefined:
      return statusPending ? 'waiting' : 'failed'
    case 'connecting':
      return 'waiting'
    case 'no_config':
    case 'locked':
    case 'error':
      return 'not_connected'
    case 'ready':
      return 'failed'
  }
}

/** `avatarPath` from the substrate is a file path unless the host mapped it to a servable URL. */
export function servableAvatar(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (/^(https?:|data:|blob:|aiwc-media:)/i.test(path)) return path
  const normalised = path.replace(/\\/g, '/')
  return `aiwc-media://${normalised.startsWith('/') ? '' : '/'}${encodeURI(normalised)}`
}

export type SessionFolder = 'official' | 'collapsed' | 'pinned'
export interface SessionDisplayRow extends WxSession {
  folder?: SessionFolder
  child?: boolean
  count?: number
}

/** Derived UI groups only: no invented sessions are stored or passed to message APIs. Components pass their `useT()` translator so a language switch rebuilds the folder rows. */
export function buildSessionRows(
  sessions: readonly WxSession[],
  expanded: ReadonlySet<SessionFolder>,
  searching = false,
  translate: Translator = t,
): SessionDisplayRow[] {
  const real = sessions.filter(
    (s) =>
      !['brandsessionholder', '@brandsessionholder', 'placeholder_foldgroup', '@placeholder_foldgroup'].includes(s.id),
  )
  const recent = (a: WxSession, b: WxSession) =>
    (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.id.localeCompare(b.id)
  if (searching) return [...real].sort((a, b) => Number(b.pinned) - Number(a.pinned) || recent(a, b))
  const officials = real.filter((s) => s.kind === 'official' || s.id.startsWith('gh_')).sort(recent)
  const collapsed = real.filter((s) => s.kind === 'group' && s.collapsed).sort(recent)
  const grouped = new Set([...officials, ...collapsed].map((s) => s.id))
  const regular = real.filter((s) => !grouped.has(s.id))
  const pinned = regular.filter((s) => s.pinned).sort(recent)
  const normal: SessionDisplayRow[] = regular.filter((s) => !s.pinned)
  const groups: Partial<Record<SessionFolder, WxSession[]>> = { official: officials, collapsed, pinned }
  const folder = (key: SessionFolder, title: string, children: WxSession[]): SessionDisplayRow => ({
    id: `ui-folder:${key}`,
    folder: key,
    kind: 'system',
    title,
    count: children.length,
    pinned: key === 'pinned',
    muted: false,
    unread: children.reduce((sum, s) => sum + s.unread, 0),
    lastMessageAt: children[0]?.lastMessageAt,
    lastPreview: children[0]?.lastPreview
      ? translate('shell.sessions.namedPreview', { name: children[0].title, preview: sessionSubtitle(children[0]) })
      : undefined,
  })
  if (officials.length) normal.push(folder('official', translate('shell.sessions.folders.official'), officials))
  if (collapsed.length) normal.push(folder('collapsed', translate('shell.sessions.folders.collapsed'), collapsed))
  normal.sort(recent)
  const top = pinned.length ? [folder('pinned', translate('shell.sessions.folders.pinned'), pinned)] : []
  return [...top, ...normal].flatMap((s) =>
    s.folder && expanded.has(s.folder)
      ? [s, ...(groups[s.folder] ?? []).map((child) => ({ ...child, child: true }))]
      : [s],
  )
}
