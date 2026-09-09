import { describe, expect, it } from 'vitest'
import type { StatsResult, WxSession } from '@aiwc/protocol'
import { countsSummary, readOverview, sessionMeta, syncView } from './syncModel'

const NOW = new Date(2026, 8, 5, 14, 32).getTime()

describe('readOverview', () => {
  it('reads the canonical single row', () => {
    const stats: StatsResult = { metric: 'overview', rows: [{ total: 14238, textCount: 1, imageCount: 942, fileCount: 186, voiceCount: 78 }] }
    expect(readOverview(stats)).toEqual({ total: 14238, imageCount: 942, fileCount: 186, voiceCount: 78 })
  })
  it('accepts key/value rows and falls back to stats.total', () => {
    const stats: StatsResult = { metric: 'overview', total: 30, rows: [{ key: 'media', label: '媒体', value: 5 }, { key: 'voice', label: '语音', value: 2 }] }
    expect(readOverview(stats)).toEqual({ total: 30, imageCount: 0, fileCount: 0, voiceCount: 2 })
  })
  it('ignores other metrics', () => {
    expect(readOverview({ metric: 'ranking', rows: [] })).toBeUndefined()
    expect(readOverview(undefined)).toBeUndefined()
  })
})

describe('syncView', () => {
  const counts = { total: 14238, imageCount: 942, fileCount: 186, voiceCount: 78 }
  it('synced with counts', () => {
    const v = syncView({ phase: 'idle', lastSyncedAt: NOW - 2 * 60_000 }, counts, NOW)
    expect(v.phase).toBe('synced')
    expect(v.text).toBe('2 分钟前同步 · 共 14,238 条消息 / 942 张图片 / 186 个文件 / 78 段语音')
    expect(countsSummary(counts)).toContain('942 张图片')
  })
  it('syncing with progress', () => {
    const v = syncView({ phase: 'syncing', progress: { done: 1240, total: 14238, label: '正在同步' } }, counts, NOW)
    expect(v.phase).toBe('syncing')
    expect(v.progress).toBe(9)
    expect(v.text).toBe('正在同步… 已拉取 1,240 / 14,238 条')
  })
  it('error and never', () => {
    expect(syncView({ phase: 'error', error: '数据库被锁定' }, undefined, NOW)).toMatchObject({ phase: 'error', detail: '数据库被锁定' })
    expect(syncView({ phase: 'idle' }, undefined, NOW)).toMatchObject({ phase: 'never', text: '尚未同步' })
    expect(syncView(undefined, undefined, NOW).phase).toBe('never')
  })
})

describe('sessionMeta', () => {
  const base: WxSession = { id: 'g@chatroom', kind: 'group', title: '产品市场群', unread: 0, pinned: false, muted: false, memberCount: 18, indexedUntil: NOW }
  it('group with members and indexed time', () => {
    expect(sessionMeta(base, NOW)).toBe('群聊 · 18 人 · 已索引到 14:32')
  })
  it('dm without index', () => {
    expect(sessionMeta({ ...base, kind: 'dm', memberCount: undefined, indexedUntil: undefined }, NOW)).toBe('单聊 · 未索引')
  })
})
