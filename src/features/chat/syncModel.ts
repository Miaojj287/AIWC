/**
 * Sync bar state machine + header meta text (DESIGN-SPEC §1.2 头部 / 同步条). Pure functions over
 * SyncStatus / StatsResult / WxSession so the bar is trivially testable.
 */
import type { StatsResult, SyncStatus, WxSession } from '@aiwc/protocol'
import { t } from '@/i18n'
import { formatClock, formatNumber, formatRelative, formatTime } from '@/platform/format'
import { readStatsOverview } from '@/platform/statsOverview'

export interface OverviewCounts {
  total: number
  imageCount: number
  fileCount: number
  voiceCount: number
}

/**
 * Read the `overview` metric. Delegates to the shared reader in platform/statsOverview so the chat
 * header and the clone page can never disagree about what "N 条消息" means.
 */
export function readOverview(stats: StatsResult | undefined): OverviewCounts | undefined {
  const o = readStatsOverview(stats)
  if (!o) return undefined
  return { total: o.total, imageCount: o.imageCount, fileCount: o.fileCount, voiceCount: o.voiceCount }
}

export function countsSummary(counts: OverviewCounts): string {
  // Numbers pick the plural form, the *Text params carry the grouped digits (1,284).
  return t('chat.sync.countsSummary', {
    messages: counts.total,
    messagesText: formatNumber(counts.total),
    images: counts.imageCount,
    imagesText: formatNumber(counts.imageCount),
    files: counts.fileCount,
    filesText: formatNumber(counts.fileCount),
    voices: counts.voiceCount,
    voicesText: formatNumber(counts.voiceCount),
  })
}

export type SyncPhaseView = 'never' | 'synced' | 'syncing' | 'error'

export interface SyncView {
  phase: SyncPhaseView
  /** Main line of the bar. */
  text: string
  /** 0–100 while syncing when the total is known. */
  progress?: number
  /** Tooltip / detail (error message, full timestamp). */
  detail?: string
}

export function syncView(
  sync: SyncStatus | undefined,
  counts: OverviewCounts | undefined,
  now: number = Date.now(),
): SyncView {
  if (!sync) return { phase: 'never', text: t('chat.sync.loadingStatus') }
  if (sync.phase === 'syncing') {
    const p = sync.progress
    const label = p?.label ?? t('chat.sync.syncing')
    if (p && p.total > 0) {
      return {
        phase: 'syncing',
        text: t('chat.sync.syncingProgress', { label, done: formatNumber(p.done), total: formatNumber(p.total) }),
        progress: Math.min(100, Math.round((p.done / p.total) * 100)),
      }
    }
    return { phase: 'syncing', text: `${label}…` }
  }
  if (sync.phase === 'error') {
    return { phase: 'error', text: t('chat.sync.failed'), detail: sync.error ?? t('chat.sync.unknownError') }
  }
  if (sync.lastSyncedAt === undefined) return { phase: 'never', text: t('chat.sync.never') }
  const when = formatRelative(sync.lastSyncedAt, now)
  // formatRelative words its result per language, so classify it against its own outputs: "just now"
  // (what it returns for a zero gap), the absolute formatTime fallback, or else a relative "N minutes ago".
  const head =
    when === formatRelative(now, now)
      ? t('chat.sync.syncedJustNow')
      : when === formatTime(sync.lastSyncedAt, now)
        ? t('chat.sync.syncedAt', { when })
        : t('chat.sync.syncedAgo', { when })
  return {
    phase: 'synced',
    text: counts ? `${head} · ${countsSummary(counts)}` : head,
    detail: t('chat.sync.syncedDetail', { time: formatClock(sync.lastSyncedAt) }),
  }
}

/** Header meta: 群聊 · 18 人 · 已索引到 14:32 */
export function sessionMeta(session: WxSession, now: number = Date.now()): string {
  const parts: string[] = [t('chat.sessionKind', { kind: session.kind })]
  if (session.kind === 'group' && typeof session.memberCount === 'number')
    parts.push(t('chat.meta.members', { n: session.memberCount }))
  if (session.indexedUntil) {
    const time = formatTime(session.indexedUntil, now)
    parts.push(t('chat.meta.indexedUntil', { time }))
  } else {
    parts.push(t('chat.meta.notIndexed'))
  }
  return parts.join(' · ')
}
