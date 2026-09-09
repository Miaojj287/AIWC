import { describe, expect, it } from 'vitest'
import { formatBytes, formatClock, formatCount, formatDateDivider, formatDuration, formatRelative, formatTime, formatVoiceDuration, truncateMiddle } from './format'

// 2026-09-06 14:30 local time
const NOW = new Date(2026, 8, 6, 14, 30, 0).getTime()
const at = (y: number, m: number, d: number, h = 9, min = 5) => new Date(y, m - 1, d, h, min).getTime()

describe('formatTime', () => {
  it('shows HH:mm for today', () => expect(formatTime(at(2026, 9, 6, 9, 5), NOW)).toBe('09:05'))
  it('shows 昨天 for yesterday', () => expect(formatTime(at(2026, 9, 5, 23, 59), NOW)).toBe('昨天'))
  it('shows M/D within the year', () => expect(formatTime(at(2026, 3, 2), NOW)).toBe('3/2'))
  it('shows YYYY/M/D for other years', () => expect(formatTime(at(2025, 12, 31), NOW)).toBe('2025/12/31'))
  it('handles empty input', () => {
    expect(formatTime(undefined, NOW)).toBe('')
    expect(formatTime(0, NOW)).toBe('')
  })
})

describe('formatDateDivider / formatRelative / formatClock', () => {
  it('divider labels', () => {
    expect(formatDateDivider(at(2026, 9, 6), NOW)).toBe('今天')
    expect(formatDateDivider(at(2026, 9, 5), NOW)).toBe('昨天')
    expect(formatDateDivider(at(2026, 8, 30), NOW)).toBe('8月30日')
    expect(formatDateDivider(at(2024, 1, 1), NOW)).toBe('2024年1月1日')
  })
  it('relative labels', () => {
    expect(formatRelative(NOW - 20_000, NOW)).toBe('刚刚')
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前')
    expect(formatRelative(at(2026, 9, 5), NOW)).toBe('昨天')
  })
  it('clock', () => expect(formatClock(at(2026, 9, 6, 7, 3))).toBe('07:03'))
})

describe('durations, bytes, counts', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(12_000)).toBe('0:12')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
  })
  it('formatVoiceDuration', () => {
    expect(formatVoiceDuration(400)).toBe('1"')
    expect(formatVoiceDuration(12_400)).toBe('12"')
  })
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB')
    expect(formatBytes(-1)).toBe('')
  })
  it('formatCount', () => {
    expect(formatCount(0)).toBe('')
    expect(formatCount(7)).toBe('7')
    expect(formatCount(120)).toBe('99+')
  })
  it('truncateMiddle', () => {
    expect(truncateMiddle('short')).toBe('short')
    const t = truncateMiddle('/Users/demo/Library/Containers/com.tencent.xinWeChat/Data', 20)
    expect(t.length).toBe(20)
    expect(t).toContain('…')
  })
})
