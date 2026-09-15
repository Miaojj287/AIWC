/**
 * Validation for `clone:updateProfile`. The patch is merged into profile.json and every edited key is
 * replayed as a correction on each re-clone. A request that is not a profile edit (another top-level key,
 * a wrong type, an oversized value) is refused before anything is read or written. Unknown keys inside
 * the card, the deep profile or a sample are dropped rather than refused: the editor sends back whole
 * objects it loaded, and a profile saved by an older version must stay editable.
 */
import type { PersonaCard, PersonaDeep, PersonaSample } from '@aiwc/protocol'
import { z } from 'zod'

/** Generous bounds: they stop runaway writes, not real edits (a sample reply is one chat message). */
const MAX_TEXT = 20_000
const MAX_ITEMS = 1_000
const MAX_KEY = 200

const text = z.string().max(MAX_TEXT)
const texts = z.array(text).max(MAX_ITEMS)

const cardPatchSchema = z
  .object({
    tone: texts,
    traits: texts,
    catchphrases: texts,
    punctuation: text,
    addressing: z.object({ self: text.optional(), other: text.optional() }),
    topics: texts,
    replyHabits: z
      .record(z.string().max(MAX_KEY), text)
      .refine((habits) => Object.keys(habits).length <= MAX_ITEMS, 'too many reply habits'),
  })
  .partial()

const deepPatchSchema = z
  .object({
    facts: texts,
    relationship: text,
    reactionPatterns: texts,
    boundaries: texts,
    sharedEvents: z.array(z.object({ when: text.optional(), what: text })).max(MAX_ITEMS),
  })
  .partial()

const sampleSchema = z.object({
  prompt: text,
  reply: text,
  at: z.number().nonnegative().optional(),
  corrected: z.boolean().optional(),
})

const profilePatchSchema = z
  .strictObject({ card: cardPatchSchema, deep: deepPatchSchema, samples: z.array(sampleSchema).max(MAX_ITEMS) })
  .partial()

export interface ProfilePatch {
  card?: Partial<PersonaCard>
  deep?: Partial<PersonaDeep>
  samples?: PersonaSample[]
}

/** Keys sent as `undefined` would overwrite stored values when the patch is spread over the profile. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** The validated patch, or undefined when the request does not describe a profile edit. */
export function parseProfilePatch(raw: unknown): ProfilePatch | undefined {
  const parsed = profilePatchSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const { card, deep, samples } = parsed.data
  return {
    ...(card && { card: withoutUndefined(card) }),
    ...(deep && { deep: withoutUndefined(deep) }),
    ...(samples && { samples }),
  }
}
