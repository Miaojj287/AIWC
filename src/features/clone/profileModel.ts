/**
 * Persona profile editing helpers (DESIGN-SPEC §4 已克隆 · 右栏): tag / catchphrase lists, reply-habit
 * KV rows and sample replace / delete, all producing `clone:updateProfile` patches. Pure — tested.
 */
import type { CloneStatus, PersonaCard, PersonaSample, RelationshipProfile } from '@aiwc/protocol'
import { t } from '@/i18n'

export type TagField = 'tone' | 'catchphrases' | 'traits'

export function addTag(list: readonly string[], raw: string): { list: string[]; error?: string } {
  const value = raw.trim()
  if (!value) return { list: [...list], error: t('clone.profile.tagEmpty') }
  if (value.length > 20) return { list: [...list], error: t('clone.profile.tagTooLong') }
  if (list.some((t) => t === value)) return { list: [...list], error: t('clone.profile.tagExists', { value }) }
  return { list: [...list, value] }
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

export function setHabit(habits: Readonly<Record<string, string>>, key: string, value: string): Record<string, string> {
  const k = key.trim()
  if (!k) return { ...habits }
  return { ...habits, [k]: value.trim() }
}

export function removeHabit(habits: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const next = { ...habits }
  delete next[key]
  return next
}

export function replaceSample(
  samples: readonly PersonaSample[],
  index: number,
  reply: string,
  at: number,
): PersonaSample[] {
  const text = reply.trim()
  if (!text) return [...samples]
  return samples.map((s, i) => (i === index ? { ...s, reply: text, at, corrected: true } : s))
}

/**
 * Prompt stored for a hand-added sample. It is persisted in the profile and sent to the model with the
 * sample, so it stays a fixed value (data, not UI copy); the editor shows a localized label for it.
 */
// eslint-disable-next-line aiwc/no-hardcoded-cjk -- 持久化进画像、随样本发给模型的占位提示，不是界面文案
export const MANUAL_SAMPLE_PROMPT = '（手动补充）'

export function appendSample(
  samples: readonly PersonaSample[],
  prompt: string,
  reply: string,
  at: number,
): PersonaSample[] {
  const text = reply.trim()
  if (!text) return [...samples]
  return [...samples, { prompt: prompt.trim() || MANUAL_SAMPLE_PROMPT, reply: text, at, corrected: true }]
}

/** Card patch for a tag-list change. */
export function cardWithTags(card: PersonaCard, field: TagField, list: string[]): PersonaCard {
  return { ...card, [field]: list }
}

/** Header meta: `基于 38 个样本 · v2 · 模型 hy3`. */
export function profileMeta(
  profile: Pick<RelationshipProfile, 'samples' | 'version'>,
  status: CloneStatus | undefined,
  modelLabel?: string,
): string {
  const parts = [t('clone.profile.meta.samples', { n: profile.samples.length })]
  if (status?.state === 'ready') parts.unshift(`v${status.version}`)
  else parts.unshift(`v${profile.version}`)
  if (modelLabel) parts.push(t('clone.profile.meta.model', { model: modelLabel }))
  return parts.join(' · ')
}

/** Copy for the clone delete dialog. */
export function deleteImpactText(): string {
  return t('clone.deleteDialog.impact')
}
