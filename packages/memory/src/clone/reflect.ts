/**
 * Reflection over a test chat: turn what the user said about the impersonation into rules the clone
 * must follow next time ('correction'), plus a one-line summary of what was talked about ('episode',
 * the clone's episodic memory).
 *
 * This is what makes the 「不像 TA」 button worth pressing: without it the feedback is filed and never
 * read again. Corrections outrank the mined profile in the prompt — the person who knows them is
 * right, the model is guessing.
 */
import type { ModelClient, PersonaNote } from '@aiwc/protocol'
import { z } from 'zod'
import { generateValidated } from '../internal/model'

export const MAX_TRANSCRIPT_CHARS = 6000
const MAX_CORRECTIONS_PER_RUN = 5

export const reflectSchema = z.object({
  corrections: z.array(z.coerce.string()).catch([]).default([]),
  summary: z.coerce.string().catch('').default(''),
})

export interface ReflectInput {
  displayName: string
  /** '我: …' / '分身: …' lines, oldest first. */
  transcript: string
}

export function reflectSystem(displayName: string): string {
  return [
    `下面是「我」和一个模仿「${displayName}」的 AI 分身的对话记录。请做两件事：`,
    `1. corrections：找出「我」对扮演效果的纠正、不满或指示（如「他才不会这么说」「你太客气了」「他喊我老张不是张哥」），改写成指导下次扮演的通用规则，一条一项，用第二人称写给分身；没有就给空数组。只收和「怎么扮演」有关的，普通聊天内容不算。`,
    '2. summary：用 1-2 句概括这段对话聊了什么，作为分身下次的「我们之前聊过」记忆；没什么可记的就给空字符串。',
    '只输出一个 JSON 对象，不要任何解释或代码围栏，格式：{ "corrections": ["规则"], "summary": "摘要" }',
  ].join('\n')
}

/** Render a persona transcript for reflection, oldest first, bounded to the most recent portion. */
export function renderTranscript(messages: readonly { role: 'user' | 'assistant'; text: string }[], displayName: string): string {
  const lines = messages.filter((m) => m.text.trim()).map((m) => `${m.role === 'user' ? '我' : `${displayName}的分身`}: ${m.text.replace(/\n+/g, ' ').trim()}`)
  let out = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string
    if (out.length + line.length > MAX_TRANSCRIPT_CHARS && out) break
    out = out ? `${line}\n${out}` : line
  }
  return out
}

/** Returns the notes to append; empty when the model found nothing worth keeping. */
export async function reflectConversation(model: ModelClient, input: ReflectInput, signal?: AbortSignal): Promise<Array<Omit<PersonaNote, 'at'>>> {
  if (!input.transcript.trim()) return []
  const result = await generateValidated(
    model,
    { system: reflectSystem(input.displayName), user: input.transcript, label: '对话反思', temperature: 0.2, maxOutputTokens: 700, ...(signal ? { signal } : {}) },
    reflectSchema,
  )
  const notes: Array<Omit<PersonaNote, 'at'>> = []
  const seen = new Set<string>()
  for (const raw of result.corrections) {
    const text = raw.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    notes.push({ kind: 'correction', text })
    if (notes.length >= MAX_CORRECTIONS_PER_RUN) break
  }
  const summary = result.summary.trim()
  if (summary) notes.push({ kind: 'episode', text: summary })
  return notes
}
