import type { StatsResult } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { readStatsOverview } from './statsOverview'

/** Exactly what packages/substrate/src/mirror/stats.ts returns (the production shape). */
const mirrorOverview = (): StatsResult => ({
  metric: 'overview',
  total: 59175,
  rows: [
    { key: 'total', value: 59175 },
    { key: 'self', value: 28000 },
    { key: 'others', value: 31175 },
    { key: 'sessions', value: 1 },
    { key: 'active_days', value: 903 },
    { key: 'media', value: 4102 },
    { key: 'first_at', value: 1_600_000_000_000 },
    { key: 'last_at', value: 1_788_000_000_000 },
    { key: 'kind:text', value: 51000 },
    { key: 'kind:image', value: 3200 },
    { key: 'kind:voice', value: 800 },
    { key: 'kind:file', value: 102 },
  ],
})

describe('readStatsOverview', () => {
  it('reads the mirror shape, including the kind:* rows', () => {
    // regression: reaching for rows[0].total here yields undefined, which is how the clone page
    // reported 「只有 0 条消息」 for a 59,175-message chat
    expect(readStatsOverview(mirrorOverview())).toEqual({
      total: 59175,
      imageCount: 3200,
      fileCount: 102,
      voiceCount: 800,
      videoCount: 0,
      firstAt: 1_600_000_000_000,
      lastAt: 1_788_000_000_000,
    })
  })

  it('reads the canonical single-row shape too', () => {
    const res: StatsResult = { metric: 'overview', rows: [{ total: 12, imageCount: 3, fileCount: 1, voiceCount: 2, videoCount: 0, firstAt: 5, lastAt: 9 }] }
    expect(readStatsOverview(res)).toMatchObject({ total: 12, imageCount: 3, voiceCount: 2, firstAt: 5 })
  })

  it('falls back to result.total when there are no rows, and refuses non-overview results', () => {
    expect(readStatsOverview({ metric: 'overview', rows: [], total: 7 })).toMatchObject({ total: 7, voiceCount: 0 })
    expect(readStatsOverview({ metric: 'overview', rows: [] })).toBeUndefined()
    expect(readStatsOverview({ metric: 'ranking', rows: [{ id: 'a', messageCount: 3 }] })).toBeUndefined()
    expect(readStatsOverview(undefined)).toBeUndefined()
  })

  it('tolerates string numbers and unknown keys', () => {
    const res: StatsResult = { metric: 'overview', rows: [{ key: 'total', value: '42' }, { key: 'weird', value: 'x' }] }
    expect(readStatsOverview(res)).toMatchObject({ total: 42, voiceCount: 0, firstAt: 0 })
  })
})
