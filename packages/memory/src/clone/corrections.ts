/**
 * User corrections (`corrections.jsonl`): written when the profile is edited, re-applied onto a freshly
 * built card / deep profile on every re-clone. Two shapes are understood:
 *  - dot path under {card, deep}, e.g. 'card.catchphrases', 'card.addressing.other',
 *    'card.replyHabits.被抱怨时', 'deep.boundaries'. Array targets: replace `from` with `to`
 *    (push when `from` is empty, remove when `to` is empty); string targets: set to `to`.
 *  - object patch: field 'card' or 'deep' with `to` = JSON of the keys the user edited (what
 *    profileEditCorrections records for clone:updateProfile); those keys replace the rebuilt ones.
 * 'samples' rows (the samples an edit removed → added) are an audit trail: corrected samples carry
 * over through their own `corrected` flag. 'feedback:<id>' rows are verdicts. Neither is applied here.
 * A correction that cannot be applied is reported in `skipped`, never dropped silently.
 */
import type { PersonaCard, PersonaDeep, PersonaSample, RelationshipProfile } from '@aiwc/protocol'

export type Correction = RelationshipProfile['corrections'][number]

export type CorrectionSkipReason = 'unparseable' | 'no_applicable_keys' | 'bad_path' | 'type_mismatch'

/** A card / deep correction that had no effect on the rebuilt profile. Carries no correction text (logged). */
export interface SkippedCorrection {
  at: number
  field: string
  reason: CorrectionSkipReason
}

type EditableProfile = Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>

type Bag = Record<string, unknown>

const CARD_KEYS = new Set<keyof PersonaCard>([
  'tone',
  'traits',
  'catchphrases',
  'punctuation',
  'addressing',
  'topics',
  'replyHabits',
])
const DEEP_KEYS = new Set<keyof PersonaDeep>([
  'facts',
  'relationship',
  'reactionPatterns',
  'boundaries',
  'sharedEvents',
])

/** Undefined when at least one key was applied; otherwise why nothing was. */
function applyObjectPatch(target: Bag, allowed: Set<string>, json: string): CorrectionSkipReason | undefined {
  let patch: unknown
  try {
    patch = JSON.parse(json)
  } catch {
    return 'unparseable'
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'unparseable'
  let touched = false
  for (const [k, v] of Object.entries(patch as Bag)) {
    if (!allowed.has(k) || v === undefined) continue
    const current = target[k]
    if (Array.isArray(current) !== Array.isArray(v) || (typeof current === 'string') !== (typeof v === 'string'))
      continue
    target[k] = v
    touched = true
  }
  return touched ? undefined : 'no_applicable_keys'
}

export function applyCorrections(
  card: PersonaCard,
  deep: PersonaDeep,
  corrections: readonly Correction[],
): { card: PersonaCard; deep: PersonaDeep; applied: number; skipped: SkippedCorrection[] } {
  const root: Bag = { card: structuredClone(card), deep: structuredClone(deep) }
  let applied = 0
  const skipped: SkippedCorrection[] = []
  const skip = (c: Correction, reason: CorrectionSkipReason) => skipped.push({ at: c.at, field: c.field, reason })
  for (const c of corrections.slice().sort((a, b) => a.at - b.at)) {
    const path = c.field.split('.').filter(Boolean)
    if (path.length === 1 && (path[0] === 'card' || path[0] === 'deep')) {
      const allowed = (path[0] === 'card' ? CARD_KEYS : DEEP_KEYS) as Set<string>
      const reason = applyObjectPatch(root[path[0]] as Bag, allowed, c.to)
      if (reason) skip(c, reason)
      else applied++
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
    if (!ok) {
      skip(c, 'bad_path')
      continue
    }
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
    } else {
      skip(c, 'type_mismatch')
    }
  }
  return { card: root.card as PersonaCard, deep: root.deep as PersonaDeep, applied, skipped }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One object-patch row holding only the keys whose value changed, or undefined when none did. */
function objectEdit<T extends object>(
  field: 'card' | 'deep',
  before: T,
  after: T,
  keys: ReadonlySet<keyof T>,
  at: number,
): Correction | undefined {
  const from: Partial<T> = {}
  const to: Partial<T> = {}
  for (const key of keys) {
    if (after[key] === undefined || sameJson(before[key], after[key])) continue
    from[key] = before[key]
    to[key] = after[key]
  }
  if (Object.keys(to).length === 0) return undefined
  return { at, field, from: JSON.stringify(from), to: JSON.stringify(to) }
}

function samplesEdit(
  before: readonly PersonaSample[],
  after: readonly PersonaSample[],
  at: number,
): Correction | undefined {
  const beforeKeys = new Set(before.map((s) => JSON.stringify(s)))
  const afterKeys = new Set(after.map((s) => JSON.stringify(s)))
  const removed = before.filter((s) => !afterKeys.has(JSON.stringify(s)))
  const added = after.filter((s) => !beforeKeys.has(JSON.stringify(s)))
  if (removed.length === 0 && added.length === 0) return undefined
  return { at, field: 'samples', from: JSON.stringify(removed), to: JSON.stringify(added) }
}

/**
 * The corrections recording one profile edit (clone:updateProfile): for card and deep an object patch of
 * the edited keys only, for samples the removed → added samples. Stored whole, never truncated, so every
 * row stays valid JSON and the edit is re-applied on the next re-clone. An edit that changed nothing
 * records nothing.
 */
export function profileEditCorrections(
  previous: EditableProfile,
  edited: Partial<EditableProfile>,
  at: number,
): Correction[] {
  const rows = [
    edited.card && objectEdit('card', previous.card, edited.card, CARD_KEYS, at),
    edited.deep && objectEdit('deep', previous.deep, edited.deep, DEEP_KEYS, at),
    edited.samples && samplesEdit(previous.samples, edited.samples, at),
  ]
  return rows.filter((row): row is Correction => row !== undefined)
}
