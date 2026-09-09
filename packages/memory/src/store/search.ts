/**
 * Zero-LLM keyword recall: score = Σ over query terms of (capped hits × position factor × term weight),
 * scaled by how many distinct terms matched, plus a bonus for the whole query appearing verbatim.
 * CJK queries are matched through bigrams so partial phrases still hit.
 */
import { countOccurrences, normaliseForCompare, tokenizeForSearch } from '../internal/text'

export interface ScoredIndex {
  index: number
  score: number
}

export function scoreText(text: string, terms: readonly string[], wholeQuery: string): number {
  if (terms.length === 0) return 0
  const hay = text.normalize('NFKC').toLowerCase()
  let score = 0
  let matched = 0
  for (const term of terms) {
    const { hits, first } = countOccurrences(hay, term)
    if (hits === 0) continue
    matched++
    const positionFactor = 1 + 1 / (1 + first / 40) // early hits count up to 2×
    const termWeight = term.length >= 3 ? 1.4 : term.length === 2 ? 1 : 0.5
    score += Math.min(hits, 5) * positionFactor * termWeight
  }
  if (matched === 0) return 0
  const coverage = matched / terms.length
  score *= 0.5 + 0.5 * coverage
  if (wholeQuery && hay.includes(wholeQuery)) score += 5
  return Math.round(score * 1000) / 1000
}

export function rankEntries(entries: readonly string[], query: string): ScoredIndex[] {
  const terms = tokenizeForSearch(query)
  const whole = normaliseForCompare(query)
  const out: ScoredIndex[] = []
  entries.forEach((text, index) => {
    const score = scoreText(text, terms, whole)
    if (score > 0) out.push({ index, score })
  })
  return out.sort((a, b) => b.score - a.score || a.index - b.index)
}
