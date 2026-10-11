import { describe, expect, it } from 'vitest'
import type { ModelCallRecord } from '@aiwc/protocol'
import { appendCalls, chartBars, formatSeconds, formatTokens, nextCursor, sharePct } from './usageModel'

const day = (d: string, inputTokens: number, outputTokens = 0) => ({
  day: d,
  requests: inputTokens ? 1 : 0,
  errors: 0,
  inputTokens,
  outputTokens,
  cachedInputTokens: 0,
  reasoningTokens: 0,
})

const call = (id: string, at: number) => ({ id, at }) as ModelCallRecord

describe('usage page helpers', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1234)).toBe('1.2K')
    expect(formatTokens(3_400_000)).toBe('3.4M')
    expect(formatTokens(250_000)).toBe('250K')
  })
  it('scales bars to the busiest day and keeps small days visible', () => {
    const bars = chartBars([day('a', 1000), day('b', 0), day('c', 10)])
    expect(bars.map((b) => Math.round(b.pct))).toEqual([100, 0, 3])
    expect(chartBars([day('a', 0)])[0]?.pct).toBe(0)
  })
  it('computes shares, cursors and de-duplicated pages', () => {
    expect(sharePct(25, 100)).toBe(25)
    expect(sharePct(1, 0)).toBe(0)
    expect(nextCursor([call('a', 3), call('b', 2)])).toEqual({ id: 'b', at: 2 })
    expect(appendCalls([call('a', 3)], [call('a', 3), call('b', 2)]).map((c) => c.id)).toEqual(['a', 'b'])
    expect(formatSeconds(820)).toBe('0.8')
    expect(formatSeconds(14_200)).toBe('14')
  })
})
