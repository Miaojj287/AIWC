/**
 * Clone LLM layer: one JSON shape ("partial") covers both the style card and the deep profile so a
 * chunk costs one call; the reduce step merges partials (model call, local fallback) and caps sizes.
 */
import type { ModelClient, PersonaCard, PersonaDeep } from '@aiwc/protocol'
import { z } from 'zod'
import { generateValidated } from '../internal/model'
import { BURST_JOINER } from './corpus'

const str = z.coerce.string().catch('')
const strList = z.array(z.coerce.string()).catch([])
interface SharedEvent {
  when?: string
  what: string
}
const event = z
  .union([
    z.object({ when: z.coerce.string().optional(), what: z.coerce.string() }).transform((e): SharedEvent => e),
    z.coerce.string().transform((what): SharedEvent => ({ what })),
  ])
  .catch({ what: '' })

export const partialSchema = z.object({
  tone: strList.default([]),
  traits: strList.default([]),
  catchphrases: strList.default([]),
  punctuation: str.default(''),
  addressing: z.object({ self: z.coerce.string().optional(), other: z.coerce.string().optional() }).catch({}).default({}),
  topics: strList.default([]),
  replyHabits: z.record(z.string(), z.coerce.string()).catch({}).default({}),
  facts: strList.default([]),
  relationship: str.default(''),
  reactionPatterns: strList.default([]),
  boundaries: strList.default([]),
  sharedEvents: z.array(event).catch([]).default([]),
})

export type PersonaPartial = z.infer<typeof partialSchema>

export const CAPS = {
  tone: 6,
  traits: 8,
  catchphrases: 12,
  topics: 10,
  replyHabits: 8,
  facts: 15,
  reactionPatterns: 10,
  boundaries: 8,
  sharedEvents: 10,
} as const

export interface CloneNames {
  subjectName: string
  otherName: string
  role: 'contact' | 'self'
}

const JSON_SHAPE = `{
  "tone": ["语气与说话风格的短语，2-4 个"],
  "traits": ["性格特征短语"],
  "catchphrases": ["口头禅 / 高频用语，必须来自原文"],
  "punctuation": "标点与排版习惯，一句话（如：几乎不用句号、爱用~和省略号、习惯连发短句）",
  "addressing": { "self": "TA 的自称", "other": "TA 对对方的称呼" },
  "topics": ["常聊话题"],
  "replyHabits": { "情境（如：被抱怨时）": "典型回法（如：先调侃再安慰）" },
  "facts": ["TA 的工作/家庭/生活事实，一条一项，具体"],
  "relationship": "两人关系的定位与相处模式，1-3 句",
  "reactionPatterns": ["情境 → 典型反应"],
  "boundaries": ["TA 的立场 / 雷点 / 回避的话题 / 明显不了解的领域"],
  "sharedEvents": [{ "when": "大致时间", "what": "共同经历" }]
}`

export function chunkSystem(n: CloneNames): string {
  const who = n.role === 'self' ? '用户本人（语料中的「我」）' : `「${n.subjectName}」`
  return [
    `你是人物侧写师。下面是「${n.otherName}」和「${n.subjectName}」的一段微信聊天记录（按时间正序，一行一轮；同一人连发多条用「${BURST_JOINER}」分隔）。`,
    `请只针对 ${who} 提炼两层信息：一、说话风格（语气、性格、口头禅、标点习惯、称呼、常聊话题、回复习惯）；二、深层画像（生活事实、两人关系、情境反应、边界、共同经历）。`,
    '只依据记录本身，不要臆造；描述要具体可执行（能直接指导模仿其说话），避免空泛形容词；没有依据的字段给空数组或空字符串。',
    `只输出一个 JSON 对象，不要任何解释或代码围栏，格式：\n${JSON_SHAPE}`,
  ].join('\n')
}

export function mergeSystem(n: CloneNames): string {
  return [
    `下面是从「${n.otherName}」和「${n.subjectName}」不同时间段的聊天里分别提炼出的多份部分画像（按时间正序，越靠后越新）。`,
    '请合并成一份：去重、同类信息合并、矛盾时以更新的为准（如换了工作以新工作为准）。',
    `数量上限：tone ${CAPS.tone}、traits ${CAPS.traits}、catchphrases ${CAPS.catchphrases}、topics ${CAPS.topics}、replyHabits ${CAPS.replyHabits} 项、facts ${CAPS.facts}、reactionPatterns ${CAPS.reactionPatterns}、boundaries ${CAPS.boundaries}、sharedEvents ${CAPS.sharedEvents}。`,
    `只输出一个 JSON 对象，不要任何解释或代码围栏，格式同输入：\n${JSON_SHAPE}`,
  ].join('\n')
}

export async function extractChunk(model: ModelClient, chunkText: string, n: CloneNames, signal?: AbortSignal): Promise<PersonaPartial> {
  return generateValidated(model, { system: chunkSystem(n), user: chunkText, label: '画像分块', temperature: 0.2, signal, maxOutputTokens: 1800 }, partialSchema)
}

export async function mergeParts(model: ModelClient, parts: readonly PersonaPartial[], n: CloneNames, signal?: AbortSignal): Promise<PersonaPartial> {
  const user = parts.map((p, i) => `【第 ${i + 1} 份】\n${JSON.stringify(p, null, 1)}`).join('\n\n')
  return generateValidated(model, { system: mergeSystem(n), user, label: '画像合并', temperature: 0.2, signal, maxOutputTokens: 2200 }, partialSchema)
}

const dedupeStrings = (items: readonly string[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = raw.trim()
    const k = s.toLowerCase()
    if (!s || seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/** Deterministic reduce used when the merge call fails: newest first for scalar fields, union for lists. */
export function mergeLocally(parts: readonly PersonaPartial[]): PersonaPartial {
  const latestFirst = parts.slice().reverse()
  const pick = (get: (p: PersonaPartial) => string) => latestFirst.map(get).find((s) => s.trim()) ?? ''
  const habits: Record<string, string> = {}
  for (const p of latestFirst) for (const [k, v] of Object.entries(p.replyHabits)) if (k.trim() && v.trim() && !(k in habits)) habits[k] = v
  const events = new Map<string, { when?: string; what: string }>()
  for (const p of latestFirst) for (const e of p.sharedEvents) if (e.what.trim() && !events.has(e.what)) events.set(e.what, e)
  return {
    tone: dedupeStrings(latestFirst.flatMap((p) => p.tone)),
    traits: dedupeStrings(latestFirst.flatMap((p) => p.traits)),
    catchphrases: dedupeStrings(latestFirst.flatMap((p) => p.catchphrases)),
    punctuation: pick((p) => p.punctuation),
    addressing: {
      ...(pick((p) => p.addressing.self ?? '') ? { self: pick((p) => p.addressing.self ?? '') } : {}),
      ...(pick((p) => p.addressing.other ?? '') ? { other: pick((p) => p.addressing.other ?? '') } : {}),
    },
    topics: dedupeStrings(latestFirst.flatMap((p) => p.topics)),
    replyHabits: habits,
    facts: dedupeStrings(latestFirst.flatMap((p) => p.facts)),
    relationship: pick((p) => p.relationship),
    reactionPatterns: dedupeStrings(latestFirst.flatMap((p) => p.reactionPatterns)),
    boundaries: dedupeStrings(latestFirst.flatMap((p) => p.boundaries)),
    sharedEvents: [...events.values()],
  }
}

export function toCardAndDeep(p: PersonaPartial): { card: PersonaCard; deep: PersonaDeep } {
  const habits = Object.fromEntries(Object.entries(p.replyHabits).filter(([k, v]) => k.trim() && v.trim()).slice(0, CAPS.replyHabits))
  const addressing: PersonaCard['addressing'] = {}
  if (p.addressing.self?.trim()) addressing.self = p.addressing.self.trim()
  if (p.addressing.other?.trim()) addressing.other = p.addressing.other.trim()
  return {
    card: {
      tone: dedupeStrings(p.tone).slice(0, CAPS.tone),
      traits: dedupeStrings(p.traits).slice(0, CAPS.traits),
      catchphrases: dedupeStrings(p.catchphrases).slice(0, CAPS.catchphrases),
      punctuation: p.punctuation.trim(),
      addressing,
      topics: dedupeStrings(p.topics).slice(0, CAPS.topics),
      replyHabits: habits,
    },
    deep: {
      facts: dedupeStrings(p.facts).slice(0, CAPS.facts),
      relationship: p.relationship.trim(),
      reactionPatterns: dedupeStrings(p.reactionPatterns).slice(0, CAPS.reactionPatterns),
      boundaries: dedupeStrings(p.boundaries).slice(0, CAPS.boundaries),
      sharedEvents: p.sharedEvents
        .filter((e) => e.what.trim())
        .map((e) => (e.when?.trim() ? { when: e.when.trim(), what: e.what.trim() } : { what: e.what.trim() }))
        .slice(0, CAPS.sharedEvents),
    },
  }
}
