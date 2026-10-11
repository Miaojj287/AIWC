/**
 * 设置 › 用量与记录 — pure helpers: compact token numbers, the daily chart's bar heights, shares and the call-log
 * cursor. No React, no bridge.
 */
import type { ModelCallRecord, UsageSummary, UsageTotals } from '@aiwc/protocol'

export const USAGE_PAGE_SIZE = 30

/** 1234 → 1.2K, 3_400_000 → 3.4M (the same in both UI languages). */
export function formatTokens(n: number): string {
  const abs = Math.abs(n)
  const fixed = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ''))
  if (abs >= 1_000_000_000) return `${fixed(n / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${fixed(n / 1_000_000)}M`
  if (abs >= 1_000) return `${fixed(n / 1_000)}K`
  return String(Math.round(n))
}

export const tokensOf = (t: Pick<UsageTotals, 'inputTokens' | 'outputTokens'>): number => t.inputTokens + t.outputTokens

/** Bar heights (0–100) for the daily chart; a day with any tokens gets at least a visible sliver. */
export function chartBars(
  days: UsageSummary['days'],
): Array<{ day: string; tokens: number; requests: number; pct: number }> {
  const max = Math.max(0, ...days.map(tokensOf))
  return days.map((d) => {
    const tokens = tokensOf(d)
    return {
      day: d.day,
      tokens,
      requests: d.requests,
      pct: max === 0 ? 0 : Math.max(tokens > 0 ? 3 : 0, (tokens / max) * 100),
    }
  })
}

/** Share of `part` in `total` as 0–100 (0 when there is nothing). */
export function sharePct(part: number, total: number): number {
  return total > 0 ? Math.min(100, (part / total) * 100) : 0
}

/** Cursor for the next call-log page: the last row already shown. */
export function nextCursor(items: readonly ModelCallRecord[]): { at: number; id: string } | undefined {
  const last = items.at(-1)
  return last ? { at: last.at, id: last.id } : undefined
}

/** Merge a page into the loaded list without duplicates (a call recorded meanwhile may shift pages). */
export function appendCalls(prev: readonly ModelCallRecord[], page: readonly ModelCallRecord[]): ModelCallRecord[] {
  const seen = new Set(prev.map((c) => c.id))
  return [...prev, ...page.filter((c) => !seen.has(c.id))]
}

/** Seconds with one decimal under 10 s: 0.8 / 3.2 / 14. */
export function formatSeconds(ms: number): string {
  const s = ms / 1000
  return s < 10 ? s.toFixed(1) : String(Math.round(s))
}
