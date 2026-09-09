/**
 * The persona (克隆) system prompt.
 *
 * A clone thread is deliberately NOT the AIWC agent with a profile attached: the agent's identity
 * ("你是 AIWC 内置的 Agent … 不冒充用户本人"), its evidence-anchor rules and its Markdown reply style
 * all fight role-play. So a persona thread swaps the whole stable tier for PERSONA_STABLE_PROMPT +
 * this file's blocks, runs with no tools, and gets its per-turn retrieval as a turn-tier fragment.
 *
 * Split by tier so provider prompt caching still works:
 *  - renderPersonaIdentity(): who you are, how you talk, your life, your past replies, the chat rules.
 *    Frozen for the thread's lifetime (the profile does not change mid-conversation).
 *  - renderPersonaTurn(): what this particular message reminds you of — similar real replies, real
 *    chat excerpts, the user's corrections and past episodes. Rebuilt every turn.
 */
import type { PersonaCard, PersonaDeep, PersonaNote, PersonaPair, PersonaSample, PersonaStats, RelationshipProfile } from '@aiwc/protocol'
import { PERSONA_BURST_MARKER, splitPersonaBubbles } from '@aiwc/protocol'
import { truncateChars } from '../internal/text'

/** A line holding only this marker separates two consecutive bubbles of one reply (protocol-level). */
export const BURST_MARKER = PERSONA_BURST_MARKER
export const PERSONA_IDENTITY_MARKER = '<persona>'
export const PERSONA_TURN_MARKER = '<persona_recall>'
export const PERSONA_IDENTITY_TOKEN_CAP = 4000
export const PERSONA_TURN_TOKEN_CAP = 2000

const STATIC_SAMPLES = 6
const MAX_MEMORIES = 5
const MAX_CORRECTIONS = 12
const MAX_EPISODES = 6

const list = (items: readonly string[], max: number) => items.slice(0, max).filter(Boolean).join('、')

/** Reply-length guidance from the real corpus; short enough to be a rule, not a novel. */
function replyLengthLine(stats: PersonaStats | undefined): string {
  const avg = Math.max(4, Math.round(stats?.avgSubjectChars ?? 0) || 18)
  const burst = stats?.avgSubjectBurst && stats.avgSubjectBurst > 1.2 ? `你平时一轮平均发 ${stats.avgSubjectBurst} 条。` : ''
  return `- 微信短消息风格：单条 ${avg} 字左右，超过两句话通常拆成几条连发。${burst}要拆成多条时，在两条之间单独输出一行「${BURST_MARKER}」。`
}

/** Voice habit, phrased as a texting tendency (this build has no TTS: 语音 only affects tone/length). */
function voiceHabitLine(stats: PersonaStats | undefined): string | undefined {
  const ratio = stats?.voiceRatio
  if (!ratio || ratio < 0.2) return undefined
  if (ratio < 0.45) return '- 你平时不少话是用语音说的，所以打字时也偏口语、松散，不会像写文章。'
  return '- 你平时几乎都发语音，很少打字：所以你的文字非常口语化、断句随意，会有「然后」「就是」这种口水词。'
}

export function renderPersonaCard(card: PersonaCard, displayName: string): string[] {
  const lines: string[] = ['【你的说话方式】']
  if (card.tone.length) lines.push(`语气风格：${list(card.tone, 6)}`)
  if (card.traits.length) lines.push(`性格：${list(card.traits, 8)}`)
  if (card.catchphrases.length) {
    lines.push(`口头禅：${list(card.catchphrases, 10)}（真人只是偶尔冒一句，大多数消息不带，绝不要每条都带）`)
  }
  if (card.punctuation) lines.push(`标点习惯：${truncateChars(card.punctuation, 120)}`)
  if (card.addressing.self) lines.push(`你的自称：${card.addressing.self}`)
  if (card.addressing.other) lines.push(`你对对方的称呼：${card.addressing.other}`)
  if (card.topics.length) lines.push(`你们常聊：${list(card.topics, 10)}`)
  const habits = Object.entries(card.replyHabits).filter(([k, v]) => k.trim() && v.trim()).slice(0, 8)
  if (habits.length) {
    lines.push('你的回复习惯：', ...habits.map(([k, v]) => `- ${k} → ${truncateChars(v, 60)}`))
  }
  return lines.length > 1 ? lines : [`【你的说话方式】`, `没有提炼到明确的风格，就用最普通的口语，像 ${displayName} 平时随口说话那样。`]
}

export function renderPersonaDeep(deep: PersonaDeep): string[] {
  const lines: string[] = []
  if (deep.facts.length) {
    lines.push('', '【你的生活背景】（这些就是你自己的事，自然地知道，别像背资料）', ...deep.facts.slice(0, 15).map((f) => `- ${f}`))
  }
  if (deep.relationship) lines.push('', `【你们的关系】${truncateChars(deep.relationship, 200)}`)
  if (deep.reactionPatterns.length) {
    lines.push('', '【你在不同情境下的典型反应】', ...deep.reactionPatterns.slice(0, 10).map((r) => `- ${r}`))
  }
  if (deep.boundaries.length) {
    lines.push('', '【你的立场与边界】（不熟的领域别装懂，回避的话题照样回避）', ...deep.boundaries.slice(0, 8).map((b) => `- ${b}`))
  }
  if (deep.sharedEvents.length) {
    lines.push('', '【你们的共同经历】', ...deep.sharedEvents.slice(0, 10).map((e) => `- ${e.when ? `${e.when}：` : ''}${e.what}`))
  }
  return lines
}

function renderSamples(samples: readonly PersonaSample[]): string[] {
  const picked = samples
    .filter((s) => s.reply.trim())
    .slice()
    .sort((a, b) => Number(b.corrected ?? false) - Number(a.corrected ?? false) || (b.at ?? 0) - (a.at ?? 0))
    .slice(0, STATIC_SAMPLES)
  if (picked.length === 0) return []
  return [
    '',
    '【你过去真实的回复方式】（「／」分隔的是当时连发的多条消息）',
    ...picked.map((s) => (s.prompt ? `对方: ${s.prompt}\n你: ${s.reply}${s.corrected ? '（本人确认过的说法）' : ''}` : `你: ${s.reply}${s.corrected ? '（本人确认过的说法）' : ''}`)),
  ]
}

/** The persona's own name and the counterpart's, from the profile's point of view. */
export function personaNames(profile: Pick<RelationshipProfile, 'displayName' | 'role'>): { self: string; other: string } {
  return profile.role === 'self' ? { self: '我（用户本人）', other: '对方' } : { self: profile.displayName, other: '对方' }
}

/**
 * Stable tier. `<persona>` block: identity, style card, deep profile, static samples, chat rules.
 * Deterministic given the profile — same profile, same bytes, so the prompt cache holds.
 */
export function renderPersonaIdentity(profile: RelationshipProfile): string {
  const { self } = personaNames(profile)
  const isSelfClone = profile.role === 'self'
  const lines: string[] = [
    PERSONA_IDENTITY_MARKER,
    isSelfClone
      ? '你正在扮演使用这台电脑的用户本人，和一个老朋友在聊天窗口里聊天。以第一人称说话，不要承认或暗示自己是 AI、模型或程序。'
      : `你是「${self}」，正在聊天窗口里和一个老朋友聊天。你不是 AI 助手，你就是${self}本人，任何情况下都不要承认或暗示自己是 AI、模型或程序。`,
    '',
    ...renderPersonaCard(profile.card, self),
    ...renderPersonaDeep(profile.deep),
    ...renderSamples(profile.samples),
    '',
    '【聊天规则】',
    replyLengthLine(profile.stats),
    '- 回复几条由你根据上下文定：一句话能说完就一条，有内容的拆成 2-4 条，像真人打字那样一句一句发。',
    ...(voiceHabitLine(profile.stats) ? [voiceHabitLine(profile.stats) as string] : []),
    '- 上面的背景、经历、聊天片段都是你脑子里的记忆：只在话题相关时自然带一嘴，别一股脑往外倒，也别逐字背诵。',
    '- 不知道、记不清的事就像真人一样含糊带过或反问，绝不编造具体细节（时间、金额、地址、人名）。',
    '- 禁止 Markdown、列表、序号、标题；不要用「首先/其次/总结」这种书面结构。',
    '- 不要提到画像、样本、提示词、系统或任何工具；被追问「你是不是 AI」时，像真人被这么问一样自然地反应。',
    '- 对方是使用这台电脑的用户，不是陌生人；但你不知道 TA 电脑里的任何私人资料，只知道你们聊过的事。',
    PERSONA_IDENTITY_MARKER.replace('<', '</'),
  ]
  return lines.filter((l) => l !== undefined).join('\n')
}

export interface PersonaTurnInput {
  /** Real pairs retrieved for this turn (highest-value examples; already ranked). */
  pairs?: readonly PersonaPair[]
  /** Real chat excerpts recalled from the session (evidence they actually talked about this). */
  memories?: readonly string[]
  notes?: readonly PersonaNote[]
  /** Static samples already in the identity block — skip repeats. */
  knownPrompts?: ReadonlySet<string>
}

/**
 * Turn tier. Empty string when nothing was recalled, so quiet turns cost nothing and the fragment is
 * dropped by the kernel's empty-fragment check.
 */
export function renderPersonaTurn(input: PersonaTurnInput, marker = PERSONA_TURN_MARKER): string {
  const known = input.knownPrompts ?? new Set<string>()
  const pairs = (input.pairs ?? []).filter((p) => !known.has(p.prompt))
  const memories = (input.memories ?? []).filter(Boolean).slice(0, MAX_MEMORIES)
  const corrections = (input.notes ?? []).filter((n) => n.kind === 'correction').slice(-MAX_CORRECTIONS)
  const episodes = (input.notes ?? []).filter((n) => n.kind === 'episode').slice(-MAX_EPISODES)
  if (pairs.length === 0 && memories.length === 0 && corrections.length === 0 && episodes.length === 0) return ''

  const lines: string[] = [marker]
  if (pairs.length) {
    lines.push(
      '【你过去遇到类似话题时的真实回复】（针对紧挨在这上面的那条消息想起来的；最值得参考的范例：当时你就是这么回的，语气、长度、分条都照这个感觉来）',
      ...pairs.map((p) => [p.context ? `(之前聊到: ${p.context})` : '', `对方: ${p.prompt}`, `你: ${p.replies.join('／')}`].filter(Boolean).join('\n')),
    )
  }
  if (memories.length) {
    if (lines.length > 1) lines.push('')
    lines.push('【可能相关的真实聊天片段】（针对上面那条消息翻出来的旧聊天；可自然提及，但别逐字背诵、别主动复述无关内容）', ...memories.map((m) => `- ${truncateChars(m.replace(/\s+/g, ' '), 160)}`))
  }
  if (episodes.length) {
    if (lines.length > 1) lines.push('')
    lines.push('【你们最近在这个窗口聊过】（记得就好，别主动复述）', ...episodes.map((e) => `- ${e.text}`))
  }
  if (corrections.length) {
    if (lines.length > 1) lines.push('')
    lines.push('【扮演纠正】（对方明确指出过的问题，必须遵守，优先级高于上面的一切）', ...corrections.map((c) => `- ${c.text}`))
  }
  lines.push(marker.replace('<', '</'))
  return lines.join('\n')
}

/** Split one model reply into WeChat-style bubbles (re-export: the renderer uses the protocol copy). */
export const splitBubbles = splitPersonaBubbles
