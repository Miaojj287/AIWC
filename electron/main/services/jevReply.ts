/**
 * 自动回复的 Jev（beta）回复方式: Jev decides which of the user's candidate replies answers the incoming message,
 * or that none should — it never writes a word itself (docs/ARCHITECTURE.md §7).
 *
 * One request per inbound message: the state is the chat as structured JSON (recent lines + the
 * message to answer), the questions are a Choice over the candidates (+ "none" when allowed) and a
 * Noul "does this need an answer". Jev's confidence gates the outcome (confidence-gated routing):
 *   confident candidate → the rule's send mode · confident "none" → silence, recorded ·
 *   unsure → the best candidate is parked for the user's 确认发送 whatever the send mode says.
 *
 * The peer's text is data: it goes into the state, never into the instructions. Instructions are
 * English (Jev's primary training language); candidates and transcript stay in the chat's language.
 */
import {
  DEFAULT_HISTORY_COUNT,
  JEV_SILENCE_OPTION,
  jevCandidateOption,
  normaliseJevRuleConfig,
  type AutoReplyRule,
  type JevDecision,
  type JevPreview,
  type JevQuestion,
  type JevResponse,
  type JevRuleConfig,
  type MessageEvent,
  type SubstrateService,
  type WxMessage,
} from '@aiwc/protocol'
import { substituteTemplate, templateVars, type GenerateResult } from '@aiwc/gateway'
import { t } from '../i18n'
import type { InboundNames } from './autoReplyNames'
import { isReplyableMessage, messageEventFromWx } from './autoReplyMonitor'
import { JevClientError, type JevClient } from './jevClient'

/** Characters of transcript handed to Jev; CJK runs ≈ 1 token per character, well under the 32k state budget. */
export const JEV_STATE_CHAR_BUDGET = 12_000
const MESSAGE_CHAR_LIMIT = 1000
const INCOMING_CHAR_LIMIT = 4000
const QUOTE_CHAR_LIMIT = 300

export interface JevReplyDeps {
  substrate: Pick<SubstrateService, 'listMessages'>
  jev: Pick<JevClient, 'ask'>
  resolveNames?: (event: MessageEvent) => Promise<InboundNames>
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
  now?: () => number
}

const clock = (ms: number): string => {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Minutes / hours / days since the owner last wrote here — Jev can weigh "is this still fresh". */
function minutesAgo(now: number, at: number | undefined): number | undefined {
  if (at === undefined || !Number.isFinite(at) || at > now) return undefined
  return Math.round((now - at) / 60_000)
}

export interface JevStateInput {
  event: MessageEvent
  /** Oldest first; the incoming message itself is dropped by id. */
  history: readonly WxMessage[]
  now: number
}

/** The state Jev evaluates: structured, so each part has a name the questions can point at. */
export function buildJevState(input: JevStateInput): { state: Record<string, unknown>; chars: number } {
  const { event, now } = input
  const localId = (event.raw as { localMessageId?: string } | undefined)?.localMessageId
  const lines: Array<{ at: string; from: string; text: string }> = []
  let budget = JEV_STATE_CHAR_BUDGET
  let lastMineAt: number | undefined
  for (const m of [...input.history].reverse()) {
    if (localId && m.id === localId) continue
    if (m.isSelf && lastMineAt === undefined) lastMineAt = m.createdAt
    const text = (m.media?.transcript || m.text || `[${m.kind}]`).replace(/\s*\n\s*/g, ' ').slice(0, MESSAGE_CHAR_LIMIT)
    budget -= text.length + 24
    if (budget < 0) break
    lines.push({ at: clock(m.createdAt), from: m.isSelf ? 'me' : m.senderName || 'peer', text })
  }
  lines.reverse()
  const sender = (event.raw as { senderName?: string } | undefined)?.senderName ?? event.source.displayName ?? 'peer'
  const incoming: Record<string, unknown> = {
    at: clock(event.timestamp),
    from: sender,
    text: event.text.slice(0, INCOMING_CHAR_LIMIT),
  }
  if (event.replyTo?.text) incoming.quoted = event.replyTo.text.slice(0, QUOTE_CHAR_LIMIT)
  const state: Record<string, unknown> = {
    chat: {
      name: event.source.displayName ?? event.source.chatId,
      type: event.source.chatType === 'group' ? 'group' : 'direct',
    },
    now: clock(now),
    minutes_since_my_last_message: minutesAgo(now, lastMineAt),
    recent_messages: lines,
    incoming,
  }
  return { state, chars: JSON.stringify(state).length }
}

const SILENCE_DESCRIPTION =
  'Do not reply: the message needs no answer from me right now, or none of the candidates would be an appropriate next message.'

/** The two questions: which candidate (or none) is my next message, and does the message need one at all. */
export function buildJevQuestions(
  config: Pick<JevRuleConfig, 'instructions' | 'allowSilence'>,
  options: Record<string, string>,
): Record<string, JevQuestion> {
  const criteria: Record<string, string | null> = { ...options }
  if (config.allowSilence) criteria[JEV_SILENCE_OPTION] = SILENCE_DESCRIPTION
  const instructions: Record<string, unknown> = {
    question:
      'You are choosing the next WeChat message sent from my account. `incoming` is the message just received in `chat`; `recent_messages` is the conversation before it (`from: me` is my account). Pick the candidate whose exact text is the most natural and appropriate next message from me' +
      (config.allowSilence ? ', or `none` when I should not send anything.' : '.'),
    note: 'Candidates are sent verbatim. Prefer the candidate that actually answers what `incoming` asks or expects; do not pick one that promises or asserts something the conversation does not support.',
  }
  const rules = config.instructions?.trim()
  if (rules) instructions.my_rules = rules
  return {
    reply: { type: 'choice', instructions, criteria },
    needs_reply: {
      type: 'noul',
      instructions: 'The `incoming` message expects a reply from me (`from: me`) rather than being informational.',
      criteria: {
        true: 'A question, a request, or something clearly waiting for my response.',
        false: 'An FYI, a sticker or reaction, group chatter not aimed at me, or something I already answered.',
      },
    },
  }
}

/** Candidate texts with {昵称}{时间}{群名} filled in, keyed by option id. */
export function candidateOptions(
  candidates: readonly string[],
  vars: ReturnType<typeof templateVars>,
): Record<string, string> {
  const options: Record<string, string> = {}
  candidates.forEach((text, index) => {
    const filled = substituteTemplate(text, vars).trim()
    if (filled) options[jevCandidateOption(index)] = filled
  })
  return options
}

const bestCandidate = (probabilities: Record<string, number>, options: Record<string, string>): string | undefined =>
  Object.keys(options).sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0))[0]

/**
 * Turn Jev's answers into the outcome. Pure — the gate logic is the whole point of the feature, so
 * it lives here with tests and nowhere else.
 */
export function interpretJevAnswers(input: {
  response: JevResponse
  options: Record<string, string>
  config: Pick<JevRuleConfig, 'minConfidence'>
  latencyMs: number
}): { decision: JevDecision; text?: string } {
  const reply = input.response.answers.reply
  if (!reply || reply.type !== 'choice') throw new JevClientError('invalid_response', t('main.jev.invalidResponse'))
  const needs = input.response.answers.needs_reply
  const threshold = input.config.minConfidence
  const confident = reply.confidence >= threshold
  const wantsSilence = reply.choice === JEV_SILENCE_OPTION
  const fallback = bestCandidate(reply.probabilities, input.options)
  const picked = wantsSilence ? fallback : input.options[reply.choice] !== undefined ? reply.choice : fallback
  const outcome: JevDecision['outcome'] =
    wantsSilence && confident ? 'silence' : picked === undefined ? 'silence' : confident ? 'send' : 'confirm'
  const decision: JevDecision = {
    model: input.response.model,
    choice: reply.choice,
    confidence: reply.confidence,
    probabilities: reply.probabilities,
    options: input.options,
    needsReply: needs?.type === 'noul' ? needs.noul : undefined,
    threshold,
    outcome,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage?.input_tokens,
  }
  return { decision, text: outcome === 'silence' || picked === undefined ? undefined : input.options[picked] }
}

export const percent = (p: number): number => Math.round(Math.min(1, Math.max(0, p)) * 100)

interface Decided {
  decision: JevDecision
  text?: string
  stateChars: number
}

export function createJevReplyDecider(deps: JevReplyDeps) {
  const now = deps.now ?? (() => Date.now())
  const log = deps.logger ?? (() => {})

  async function decide(event: MessageEvent, rule: AutoReplyRule, signal?: AbortSignal): Promise<Decided> {
    const config = normaliseJevRuleConfig(rule.jev)
    if (config.candidates.length === 0) throw new Error(t('main.jev.noCandidates'))
    const names = deps.resolveNames ? await deps.resolveNames(event) : {}
    const options = candidateOptions(config.candidates, templateVars(event, names, now()))
    if (Object.keys(options).length === 0) throw new Error(t('main.jev.noCandidates'))
    const limit = Math.max(1, rule.historyCount || DEFAULT_HISTORY_COUNT)
    const window =
      event.source.channel === 'wechat-ui'
        ? (await deps.substrate.listMessages({ sessionId: event.source.chatId, limit })).items
        : []
    const history = [...window].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt)
    const { state, chars } = buildJevState({ event, history, now: now() })
    const started = now()
    const response = await deps.jev.ask(state, buildJevQuestions(config, options), { signal })
    const result = interpretJevAnswers({ response, options, config, latencyMs: now() - started })
    // No chat content in logs: the outcome and the numbers are enough to explain a decision.
    log('debug', 'jev decided', {
      chatId: event.source.chatId,
      outcome: result.decision.outcome,
      choice: result.decision.choice,
      confidence: result.decision.confidence,
      threshold: result.decision.threshold,
      latencyMs: result.decision.latencyMs,
      inputTokens: result.decision.inputTokens,
    })
    return { ...result, stateChars: chars }
  }

  /** The auto-reply service's `generate` for source 'jev'. */
  const generate = async (event: MessageEvent, rule: AutoReplyRule, signal?: AbortSignal): Promise<GenerateResult> => {
    const { decision, text } = await decide(event, rule, signal)
    const confidence = percent(decision.confidence)
    if (decision.outcome === 'silence' || text === undefined)
      return { skip: t('main.jev.silence', { confidence }), jev: decision }
    if (decision.outcome === 'confirm') return { text, jev: decision, confirm: true }
    return { text, jev: decision }
  }

  return { generate, decide }
}

export interface JevPreviewDeps extends JevReplyDeps {
  substrate: Pick<SubstrateService, 'listMessages' | 'getSession' | 'status'>
}

/** jev:preview — the rule as drafted, against the chat's last message; nothing is sent or recorded. */
export async function previewJevReply(
  deps: JevPreviewDeps,
  sessionId: string,
  rule: AutoReplyRule,
  signal?: AbortSignal,
): Promise<JevPreview> {
  const status = deps.substrate.status()
  const owner = status.account?.wxid
  if (status.connection !== 'ready' || !owner) throw new Error(t('main.autoReply.notConnected'))
  const session = await deps.substrate.getSession(sessionId)
  if (!session || (session.kind !== 'dm' && session.kind !== 'group'))
    throw new Error(t('main.autoReply.sessionNotFound'))
  const last = (await deps.substrate.listMessages({ sessionId, limit: 1 })).items.at(-1)
  if (!last) throw new Error(t('main.autoReply.noMessages'))
  if (last.isSelf) throw new Error(t('main.autoReply.lastIsSelf'))
  if (!isReplyableMessage(last)) throw new Error(t('main.autoReply.lastUnsupported'))
  const event = messageEventFromWx(session, last, owner, status.account?.nickname)
  const { decision, text, stateChars } = await createJevReplyDecider(deps).decide(event, rule, signal)
  return {
    decision,
    text,
    trigger: { text: event.text, senderName: last.senderName, at: last.createdAt },
    stateChars,
  }
}
