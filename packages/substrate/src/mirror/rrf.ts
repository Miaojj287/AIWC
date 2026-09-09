/** Reciprocal rank fusion (ported from AIWC_ORG electron/services/retrieval/rrf.ts). */
import type { SearchHit } from '@aiwc/protocol'
import type { VectorSearchHit } from './types'

export interface RrfRankedItem<T> {
  item: T
  rank: number
  score?: number
}

export interface RrfMergedItem<T> {
  key: string
  item: T
  rrfScore: number
  ranks: number[]
  scores: number[]
}

export function reciprocalRankFusion<T>(
  rankedLists: ReadonlyArray<ReadonlyArray<RrfRankedItem<T>>>,
  getKey: (item: T) => string,
  k = 60,
): RrfMergedItem<T>[] {
  const safeK = Math.max(1, Math.floor(k || 60))
  const byKey = new Map<string, RrfMergedItem<T>>()
  for (const list of rankedLists) {
    for (let index = 0; index < list.length; index++) {
      const entry = list[index]
      if (!entry) continue
      const rank = Math.max(1, Math.floor(entry.rank || index + 1))
      const key = getKey(entry.item)
      const contribution = 1 / (safeK + rank)
      const existing = byKey.get(key)
      if (existing) {
        existing.rrfScore += contribution
        existing.ranks.push(rank)
        if (entry.score !== undefined && Number.isFinite(entry.score)) existing.scores.push(entry.score)
      } else {
        byKey.set(key, {
          key,
          item: entry.item,
          rrfScore: contribution,
          ranks: [rank],
          scores: entry.score !== undefined && Number.isFinite(entry.score) ? [entry.score] : [],
        })
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.rrfScore - a.rrfScore || Math.min(...a.ranks) - Math.min(...b.ranks))
}

export const hitKey = (h: SearchHit): string => `${h.message.sessionId} ${h.message.id}`

/**
 * Vector hits point at a chunk (anchored on its middle message) while keyword hits point at exact
 * messages. Before fusing, re-anchor each vector hit on the best keyword hit that falls inside the
 * chunk's seq range so both lists share keys; unmatched vector hits keep their anchor.
 */
export function alignVectorHits(vector: readonly VectorSearchHit[], keyword: readonly SearchHit[]): SearchHit[] {
  const used = new Set<string>()
  return vector.map((v) => {
    const match = keyword.find(
      (k) => !used.has(hitKey(k)) && k.message.sessionId === v.message.sessionId && k.message.seq >= v.range.startSeq && k.message.seq <= v.range.endSeq,
    )
    if (!match) return v
    used.add(hitKey(match))
    return { message: match.message, score: v.score, snippet: v.snippet, source: 'vector' }
  })
}

/** Fuse keyword + vector hit lists into one ranked list; items present in more than one list become 'fused'. */
export function fuseHits(lists: ReadonlyArray<readonly SearchHit[]>, limit: number, k = 60): SearchHit[] {
  const ranked = lists.map((list) => list.map((hit, i) => ({ item: hit, rank: i + 1, score: hit.score })))
  const merged = reciprocalRankFusion(ranked, hitKey, k)
  const snippetFor = (key: string): string => {
    for (const list of lists) {
      const found = list.find((h) => hitKey(h) === key && h.snippet)
      if (found) return found.snippet
    }
    return ''
  }
  return merged.slice(0, Math.max(0, limit)).map((m) => ({
    message: m.item.message,
    score: m.rrfScore,
    snippet: snippetFor(m.key) || m.item.snippet,
    source: m.ranks.length > 1 ? 'fused' : m.item.source,
  }))
}
