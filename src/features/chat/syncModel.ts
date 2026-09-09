/**
 * Sync bar state machine + header meta text (DESIGN-SPEC §1.2 头部 / 同步条). Pure functions over
 * SyncStatus / StatsResult / WxSession so the bar is trivially testable.
 */
import type { StatsResult, SyncStatus, WxSession } from '@aiwc/protocol'
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
  return `共 ${formatNumber(counts.total)} 条消息 / ${formatNumber(counts.imageCount)} 张图片 / ${formatNumber(counts.fileCount)} 个文件 / ${formatNumber(counts.voiceCount)} 段语音`
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

export function syncView(sync: SyncStatus | undefined, counts: OverviewCounts | undefined, now: number = Date.now()): SyncView {
  if (!sync) return { phase: 'never', text: '正在读取同步状态…' }
  if (sync.phase === 'syncing') {
    const p = sync.progress
    const label = p?.label ?? '正在同步'
    if (p && p.total > 0) {
      return { phase: 'syncing', text: `${label}… 已拉取 ${formatNumber(p.done)} / ${formatNumber(p.total)} 条`, progress: Math.min(100, Math.round((p.done / p.total) * 100)) }
    }
    return { phase: 'syncing', text: `${label}…` }
  }
  if (sync.phase === 'error') {
    return { phase: 'error', text: '同步失败', detail: sync.error ?? '未知错误' }
  }
  if (sync.lastSyncedAt === undefined) return { phase: 'never', text: '尚未同步' }
  const when = formatRelative(sync.lastSyncedAt, now)
  const head = when === '刚刚' ? '刚刚同步' : /前$/.test(when) ? `${when}同步` : `${when} 同步`
  return { phase: 'synced', text: counts ? `${head} · ${countsSummary(counts)}` : head, detail: `上次同步 ${formatClock(sync.lastSyncedAt)} · 点击立即同步` }
}

const KIND_LABEL: Record<WxSession['kind'], string> = { dm: '单聊', group: '群聊', official: '公众号', system: '系统' }

/** Header meta: 群聊 · 18 人 · 已索引到 14:32 */
export function sessionMeta(session: WxSession, now: number = Date.now()): string {
  const parts: string[] = [KIND_LABEL[session.kind]]
  if (session.kind === 'group' && typeof session.memberCount === 'number') parts.push(`${session.memberCount} 人`)
  if (session.indexedUntil) {
    const t = formatTime(session.indexedUntil, now)
    parts.push(`已索引到 ${t}`)
  } else {
    parts.push('未索引')
  }
  return parts.join(' · ')
}
