/**
 * Persona profile editing helpers (DESIGN-SPEC §4 已克隆 · 右栏): tag / catchphrase lists, reply-habit
 * KV rows and sample replace / delete, all producing `clone:updateProfile` patches. Pure — tested.
 */
import type { CloneStatus, PersonaCard, PersonaSample, RelationshipProfile } from '@aiwc/protocol'

export type TagField = 'tone' | 'catchphrases' | 'traits'

export function addTag(list: readonly string[], raw: string): { list: string[]; error?: string } {
  const value = raw.trim()
  if (!value) return { list: [...list], error: '内容不能为空' }
  if (value.length > 20) return { list: [...list], error: '不超过 20 个字' }
  if (list.some((t) => t === value)) return { list: [...list], error: `「${value}」已存在` }
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

export function replaceSample(samples: readonly PersonaSample[], index: number, reply: string, at: number): PersonaSample[] {
  const text = reply.trim()
  if (!text) return [...samples]
  return samples.map((s, i) => (i === index ? { ...s, reply: text, at, corrected: true } : s))
}

export function appendSample(samples: readonly PersonaSample[], prompt: string, reply: string, at: number): PersonaSample[] {
  const text = reply.trim()
  if (!text) return [...samples]
  return [...samples, { prompt: prompt.trim() || '（手动补充）', reply: text, at, corrected: true }]
}

/** Card patch for a tag-list change. */
export function cardWithTags(card: PersonaCard, field: TagField, list: string[]): PersonaCard {
  return { ...card, [field]: list }
}

/** Header meta: `基于 38 个样本 · v2 · 模型 hy3`. */
export function profileMeta(profile: Pick<RelationshipProfile, 'samples' | 'version'>, status: CloneStatus | undefined, modelLabel?: string): string {
  const parts = [`${profile.samples.length} 个样本`]
  if (status?.state === 'ready') parts.unshift(`v${status.version}`)
  else parts.unshift(`v${profile.version}`)
  if (modelLabel) parts.push(`模型 ${modelLabel}`)
  return parts.join(' · ')
}

/** Copy for the clone delete dialog. */
export function deleteImpactText(): string {
  return '画像、样本对话与试聊记录会从本机删除，且不可恢复。自动回复不受影响。'
}
