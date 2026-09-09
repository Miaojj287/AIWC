/**
 * One reader for the `overview` metric, shared by every page that shows "N 条消息 / N 段语音 / …".
 *
 * Why this exists: StatsResult.rows is deliberately loose (the agent tools hand rows straight to the
 * model), and the reference implementation — the mirror — returns `{ key, value }` rows with keys
 * like 'total', 'media', 'first_at' and one 'kind:<kind>' row per message kind. A page that reaches
 * for `rows[0].total` silently reads `undefined` and renders 0, which is exactly how the clone page
 * came to say 「0 条消息」 for a chat with 59,175 of them. Every reader goes through here instead,
 * and it tolerates the older single-row shape as well.
 */
import type { StatsResult } from '@aiwc/protocol'

export interface StatsOverview {
  total: number
  imageCount: number
  fileCount: number
  voiceCount: number
  videoCount: number
  /** Timestamp of the first / last message in range; 0 when unknown. */
  firstAt: number
  lastAt: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)

const EMPTY: StatsOverview = { total: 0, imageCount: 0, fileCount: 0, voiceCount: 0, videoCount: 0, firstAt: 0, lastAt: 0 }

/** undefined when the result is missing or is not an overview; never a partially-filled object. */
export function readStatsOverview(stats: StatsResult | undefined): StatsOverview | undefined {
  if (!stats || stats.metric !== 'overview') return undefined
  const rows = stats.rows
  if (rows.length === 0) return stats.total !== undefined ? { ...EMPTY, total: num(stats.total) } : undefined

  const first = rows[0]
  // canonical single-row shape (protocol/substrate.ts): { total, imageCount, voiceCount, … }
  if (first && !('key' in first) && ('total' in first || 'voiceCount' in first)) {
    return {
      total: num(first.total),
      imageCount: num(first.imageCount),
      fileCount: num(first.fileCount),
      voiceCount: num(first.voiceCount),
      videoCount: num(first.videoCount),
      firstAt: num(first.firstAt),
      lastAt: num(first.lastAt),
    }
  }

  const byKey = new Map<string, number>()
  for (const r of rows) if (typeof r.key === 'string') byKey.set(r.key, num(r.value))
  const pick = (...keys: string[]) => {
    for (const k of keys) if (byKey.has(k)) return byKey.get(k) as number
    return 0
  }
  return {
    total: byKey.has('total') || byKey.has('messages') ? pick('total', 'messages') : num(stats.total),
    imageCount: pick('kind:image', 'imageCount', 'images', 'image'),
    fileCount: pick('kind:file', 'fileCount', 'files', 'file'),
    voiceCount: pick('kind:voice', 'voiceCount', 'voice'),
    videoCount: pick('kind:video', 'videoCount', 'videos', 'video'),
    firstAt: pick('first_at', 'firstAt'),
    lastAt: pick('last_at', 'lastAt'),
  }
}
