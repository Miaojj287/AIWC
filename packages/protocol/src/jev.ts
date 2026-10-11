/**
 * Jev (TypeSafe AI's "System One" model) — the decision model behind 自动回复的 Jev（beta）回复方式.
 *
 * Jev does not write text. It evaluates a `state` against typed questions and returns typed answers
 * with calibrated probabilities: a Choice picks one option, a Noul is the probability a statement is
 * true, a Score rates against ordered levels. The auto-reply rule therefore gives Jev the candidate
 * replies the user wrote, and Jev only decides which one (or none) leaves the machine.
 *
 * Wire shapes follow https://docs.typesafe.ai/api (POST /v1/systemone). Kept here so the main process
 * (client), the gateway (records) and the renderer (rule editor, preview) share one definition.
 */
import { z } from 'zod'

export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
export const JEV_DEFAULT_MODEL = 'jev-latest'
/** Aliases TypeSafe publishes; a versioned id such as jev-1.13.0 is accepted too. */
export const JEV_MODEL_ALIASES = ['jev-latest', 'jev-preview'] as const

export const JEV_MIN_CANDIDATES = 1
export const JEV_MAX_CANDIDATES = 8
export const JEV_MAX_CANDIDATE_CHARS = 500
export const JEV_MAX_INSTRUCTIONS_CHARS = 2000
/** Below this confidence Jev's pick is parked for the user instead of being sent (confidence-gated routing). */
export const JEV_DEFAULT_MIN_CONFIDENCE = 0.6
export const JEV_CONFIDENCE_OPTIONS = [0.5, 0.6, 0.7, 0.8, 0.9] as const
/** The Choice option that means "do not reply"; candidate options are `c1`, `c2`, … */
export const JEV_SILENCE_OPTION = 'none'
export const jevCandidateOption = (index: number): string => `c${index + 1}`

/** The Jev part of an auto-reply rule (source 'jev'). */
export const JevRuleConfigSchema = z.object({
  /** Replies the user wrote, verbatim; the same {昵称} {时间} {群名} variables as fixed text. */
  candidates: z.array(z.string().max(JEV_MAX_CANDIDATE_CHARS)).min(JEV_MIN_CANDIDATES).max(JEV_MAX_CANDIDATES),
  /** Extra guidance for the decision (which candidate when), sent as part of the question. */
  instructions: z.string().max(JEV_MAX_INSTRUCTIONS_CHARS).optional(),
  /** Offer Jev the "do not reply" option. */
  allowSilence: z.boolean().default(true),
  /** Confidence needed to act without asking; lower → the pick waits for 确认发送. */
  minConfidence: z.number().min(0).max(1).default(JEV_DEFAULT_MIN_CONFIDENCE),
})
export type JevRuleConfig = z.infer<typeof JevRuleConfigSchema>

export const defaultJevRuleConfig = (): JevRuleConfig => ({
  candidates: [],
  allowSilence: true,
  minConfidence: JEV_DEFAULT_MIN_CONFIDENCE,
})

/** Parse a stored / renderer-supplied config; empty candidates are kept (validation reports them). */
export function normaliseJevRuleConfig(raw: unknown): JevRuleConfig {
  const base = defaultJevRuleConfig()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Record<string, unknown>
  const candidates = Array.isArray(value.candidates)
    ? value.candidates
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim().slice(0, JEV_MAX_CANDIDATE_CHARS))
        .filter((c) => c.length > 0)
        .slice(0, JEV_MAX_CANDIDATES)
    : []
  const instructions = typeof value.instructions === 'string' ? value.instructions.trim() : ''
  const minConfidence = Number(value.minConfidence)
  return {
    candidates,
    instructions: instructions ? instructions.slice(0, JEV_MAX_INSTRUCTIONS_CHARS) : undefined,
    allowSilence: value.allowSilence === undefined ? base.allowSilence : Boolean(value.allowSilence),
    minConfidence: Number.isFinite(minConfidence) ? Math.min(1, Math.max(0, minConfidence)) : base.minConfidence,
  }
}

// ---- wire format ------------------------------------------------------------------------------

/** `instructions` and `criteria` accept structure: a question in one field, the data it refers to in others. */
export type JevInstructions = string | Record<string, unknown> | unknown[]

export type JevQuestion =
  | { type: 'choice'; instructions: JevInstructions; criteria: Record<string, JevInstructions | null> }
  | { type: 'noul'; instructions: JevInstructions; criteria?: { true?: JevInstructions; false?: JevInstructions } }
  | { type: 'score'; instructions: JevInstructions; criteria: JevInstructions[] }

export interface JevRequest {
  model: string
  state: unknown
  questions: Record<string, JevQuestion>
}

const probabilities = z.record(z.string(), z.number())

export const JevAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities, confidence: z.number() }),
  z.object({ type: z.literal('noul'), noul: z.number() }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    legend: z.record(z.string(), z.string()).optional(),
    probabilities,
    confidence: z.number(),
  }),
])

export const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
})
export type JevResponse = z.infer<typeof JevResponseSchema>

export type JevErrorCode =
  | 'no_key'
  | 'unauthorized'
  | 'rate_limited'
  | 'invalid_request'
  | 'overloaded'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_response'

// ---- what the app keeps ---------------------------------------------------------------------------

export type JevOutcome = 'send' | 'confirm' | 'silence'

/**
 * One Jev decision, kept on the auto-reply record (and shown by the preview) so the user can see why
 * a reply went out, waited, or stayed silent. Option texts are stored as they were sent, so the record
 * stays readable after the rule's candidates change.
 */
export interface JevDecision {
  model: string
  /** Option id Jev picked: a candidate (`c1`…) or JEV_SILENCE_OPTION. */
  choice: string
  confidence: number
  /** Option id → probability (sums to 1). */
  probabilities: Record<string, number>
  /** Option id → the candidate text Jev saw (the silence option is absent here). */
  options: Record<string, string>
  /** P(the incoming message needs an answer), from the companion Noul question. */
  needsReply?: number
  /** The rule's threshold at decision time. */
  threshold: number
  outcome: JevOutcome
  latencyMs: number
  inputTokens?: number
}

/** Dry run of a rule against a chat's last message (jev:preview) — nothing is sent or recorded. */
export interface JevPreview {
  decision: JevDecision
  /** The reply that would leave (after variable substitution); absent when the outcome is silence. */
  text?: string
  trigger: { text: string; senderName?: string; at: number }
  /** Size of the state Jev read, for the user's sense of cost (≈ tokens / 2 for CJK). */
  stateChars: number
}

export interface JevTestResult {
  ok: boolean
  latencyMs?: number
  /** Models the key can use (GET /v1/models). */
  models?: string[]
  error?: string
  code?: JevErrorCode
}
