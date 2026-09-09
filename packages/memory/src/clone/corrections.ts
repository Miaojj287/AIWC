/**
 * Re-apply user corrections (`corrections.jsonl`) onto a freshly built card / deep profile.
 * Two shapes are understood:
 *  - dot path under {card, deep}, e.g. 'card.catchphrases', 'card.addressing.other',
 *    'card.replyHabits.被抱怨时', 'deep.boundaries'. Array targets: replace `from` with `to`
 *    (push when `from` is empty, remove when `to` is empty); string targets: set to `to`.
 *  - whole-object patch: field 'card' or 'deep' with `to` = JSON of a partial object (what the
 *    clone:updateProfile IPC records); known keys are shallow-merged onto the rebuilt profile.
 * Anything else (e.g. 'samples', 'feedback:<id>') is ignored here.
 */
import type { PersonaCard, PersonaDeep, RelationshipProfile } from '@aiwc/protocol'

export type Correction = RelationshipProfile['corrections'][number]

type Bag = Record<string, unknown>

const CARD_KEYS = new Set<keyof PersonaCard>(['tone', 'traits', 'catchphrases', 'punctuation', 'addressing', 'topics', 'replyHabits'])
const DEEP_KEYS = new Set<keyof PersonaDeep>(['facts', 'relationship', 'reactionPatterns', 'boundaries', 'sharedEvents'])

function applyObjectPatch(target: Bag, allowed: Set<string>, json: string): boolean {
  let patch: unknown
  try {
    patch = JSON.parse(json)
  } catch {
    return false
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false
  let touched = false
  for (const [k, v] of Object.entries(patch as Bag)) {
    if (!allowed.has(k) || v === undefined) continue
    const current = target[k]
    if (Array.isArray(current) !== Array.isArray(v) || (typeof current === 'string') !== (typeof v === 'string')) continue
    target[k] = v
    touched = true
  }
  return touched
}

export function applyCorrections(card: PersonaCard, deep: PersonaDeep, corrections: readonly Correction[]): { card: PersonaCard; deep: PersonaDeep; applied: number } {
  const root: Bag = { card: structuredClone(card), deep: structuredClone(deep) }
  let applied = 0
  for (const c of corrections.slice().sort((a, b) => a.at - b.at)) {
    const path = c.field.split('.').filter(Boolean)
    if (path.length === 1 && (path[0] === 'card' || path[0] === 'deep')) {
      const allowed = (path[0] === 'card' ? CARD_KEYS : DEEP_KEYS) as Set<string>
      if (applyObjectPatch(root[path[0]] as Bag, allowed, c.to)) applied++
      continue
    }
    if (path.length < 2 || (path[0] !== 'card' && path[0] !== 'deep')) continue
    let parent: Bag = root
    let ok = true
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] as string
      const next = parent[key]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        ok = false
        break
      }
      parent = next as Bag
    }
    if (!ok) continue
    const key = path[path.length - 1] as string
    const target = parent[key]
    const to = c.to.trim()
    const from = c.from.trim()
    if (Array.isArray(target)) {
      const arr = target as unknown[]
      const idx = from ? arr.findIndex((x) => typeof x === 'string' && x.trim() === from) : -1
      if (to && idx >= 0) arr[idx] = to
      else if (to && idx < 0 && !arr.some((x) => typeof x === 'string' && x.trim() === to)) arr.push(to)
      else if (!to && idx >= 0) arr.splice(idx, 1)
      else continue
      applied++
    } else if (typeof target === 'string' || target === undefined) {
      if (parent === root) continue
      if (to) parent[key] = to
      else delete parent[key]
      applied++
    }
  }
  return { card: root.card as PersonaCard, deep: root.deep as PersonaDeep, applied }
}
