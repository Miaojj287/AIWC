/**
 * Runtime shapes of persisted thread state: rollout JSONL lines, and the origin / settings the index keeps as JSON
 * columns. Both outlive the build that wrote them (version skew) and can be edited by hand, so a value that parses
 * as JSON stays untrusted until it matches these schemas.
 *
 * Kernel-local because @aiwc/protocol has no zod schemas for history items or thread settings yet. Objects are
 * loose so fields written by a newer build survive a resume; the compile-time checks at the bottom keep the
 * schemas in lockstep with the hand-written types in protocol and ports.ts.
 */
import { z } from 'zod'
import {
  PermissionModeSchema,
  type CallId,
  type ChannelKind,
  type ContentPart,
  type Event,
  type HistoryItem,
  type ItemId,
  type MentionKind,
  type StepId,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type ToolOutputContent,
  type ToolProfile,
  type TurnAbortedItem,
  type TurnId,
} from '@aiwc/protocol'
import type { RolloutLine } from '../ports'

const CHANNELS = ['desktop', 'wechat-ilink', 'wechat-ui', 'cron', 'observed'] as const satisfies readonly ChannelKind[]
const PROFILES = ['desktop-chat', 'wechat-bot', 'cron', 'subagent', 'persona'] as const satisfies readonly ToolProfile[]
const MENTION_KINDS = ['session', 'file', 'contact', 'memory'] as const satisfies readonly MentionKind[]
const ABORT_REASONS = [
  'interrupted',
  'replaced',
  'error',
  'step_cap',
  'loop_guard',
  'timeout',
] as const satisfies readonly TurnAbortedItem['reason'][]

/** Branded ids are non-empty strings at runtime; the brand only exists in the type system. */
const brandedId = <T extends string>() => z.custom<T>((value) => typeof value === 'string' && value.length > 0)
const threadId = brandedId<ThreadId>()
const turnId = brandedId<TurnId>()
const stepId = brandedId<StepId>()
const itemId = brandedId<ItemId>()
const callId = brandedId<CallId>()
const millis = z.number()

export const ThreadOriginSchema = z.looseObject({
  channel: z.enum(CHANNELS),
  chatId: z.string().optional(),
  peerId: z.string().optional(),
})

export const ThreadSettingsSchema = z.looseObject({
  // A mode removed since (the old 'plan') degrades to asking instead of discarding the thread.
  permissionMode: PermissionModeSchema.catch('ask'),
  model: z.looseObject({ providerId: z.string(), modelId: z.string() }).optional(),
  profile: z.enum(PROFILES),
  allowAlways: z.array(z.string()),
  title: z.string().optional(),
})

const ContentPartSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('text'), text: z.string() }),
  z.looseObject({ type: z.literal('image'), mediaType: z.string(), data: z.string(), name: z.string().optional() }),
  z.looseObject({ type: z.literal('file'), mediaType: z.string(), data: z.string(), name: z.string() }),
])

const MentionSchema = z.looseObject({ kind: z.enum(MENTION_KINDS), id: z.string(), label: z.string() })

const ToolOutputSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('text'), text: z.string() }),
  z.looseObject({ type: z.literal('json'), value: z.json() }),
  z.looseObject({ type: z.literal('image'), mediaType: z.string(), data: z.string() }),
])

const HistoryItemSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('user_message'),
    id: itemId,
    turnId,
    createdAt: millis,
    content: z.array(ContentPartSchema),
    mentions: z.array(MentionSchema),
  }),
  z.looseObject({
    type: z.literal('assistant_message'),
    id: itemId,
    turnId,
    stepId,
    createdAt: millis,
    text: z.string(),
    reasoning: z.string().optional(),
    modelId: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal('tool_call'),
    id: itemId,
    turnId,
    stepId,
    createdAt: millis,
    callId,
    toolName: z.string(),
    input: z.json(),
  }),
  z.looseObject({
    type: z.literal('tool_result'),
    id: itemId,
    turnId,
    stepId,
    createdAt: millis,
    callId,
    toolName: z.string(),
    output: ToolOutputSchema,
    isError: z.boolean(),
    durationMs: z.number(),
    truncated: z.boolean(),
  }),
  z.looseObject({
    type: z.literal('context_fragment'),
    id: itemId,
    turnId: turnId.nullable(),
    createdAt: millis,
    kind: z.string(),
    marker: z.string(),
    text: z.string(),
    tokenEstimate: z.number(),
  }),
  z.looseObject({
    type: z.literal('compaction_summary'),
    id: itemId,
    createdAt: millis,
    summary: z.string(),
    foldedItemCount: z.number(),
    foldedThroughId: itemId,
    tokenEstimate: z.number(),
  }),
  z.looseObject({
    type: z.literal('turn_aborted'),
    id: itemId,
    turnId,
    createdAt: millis,
    reason: z.enum(ABORT_REASONS),
  }),
])

/** Replay never reads event payloads, so an event line only has to look like an event. */
const EventSchema = z.custom<Event>(
  (value) => typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string',
)

const RolloutLineSchema = z.discriminatedUnion('type', [
  z.looseObject({
    ts: millis,
    type: z.literal('thread_meta'),
    threadId,
    origin: ThreadOriginSchema,
    settings: ThreadSettingsSchema,
    title: z.string().optional(),
  }),
  z.looseObject({ ts: millis, type: z.literal('settings'), settings: ThreadSettingsSchema }),
  z.looseObject({ ts: millis, type: z.literal('item'), item: HistoryItemSchema }),
  z.looseObject({ ts: millis, type: z.literal('compacted'), summaryItemId: itemId, foldedThroughId: itemId }),
  z.looseObject({
    ts: millis,
    type: z.literal('turn_context'),
    turnId,
    modelId: z.string(),
    profile: z.enum(PROFILES),
    permissionMode: PermissionModeSchema.catch('ask'),
  }),
  z.looseObject({ ts: millis, type: z.literal('world_state'), snapshot: z.record(z.string(), z.json()) }),
  z.looseObject({ ts: millis, type: z.literal('event'), event: EventSchema }),
])

/** Where a stored value failed its schema. Codes and paths only: the values themselves may be chat text. */
export type ShapeIssue = { code: string; path: string }

export function shapeIssues(error: z.ZodError): ShapeIssue[] {
  return error.issues.map((issue) => ({ code: issue.code, path: issue.path.map(String).join('.') }))
}

/** Why a line was not used: a torn write does not parse; version skew or a manual edit gives the wrong shape. */
export type LineRejection = { reason: 'invalid_json' } | { reason: 'invalid_shape'; issues: ShapeIssue[] }

/** Parses one JSONL line against the rollout schema. Never throws. */
export function parseRolloutLine(
  text: string,
): { ok: true; line: RolloutLine } | { ok: false; rejection: LineRejection } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, rejection: { reason: 'invalid_json' } }
  }
  const parsed = RolloutLineSchema.safeParse(value)
  return parsed.success
    ? { ok: true, line: parsed.data }
    : { ok: false, rejection: { reason: 'invalid_shape', issues: shapeIssues(parsed.error) } }
}

// ---------------------------------------------------------------------------------------------
// Lockstep with the hand-written types (compile time only). Output checks catch a schema missing or widening a
// field; since loose inputs cannot be compared to interfaces, completeness checks catch a literal set the types
// allow but the schema would reject.
// ---------------------------------------------------------------------------------------------

type AssertAssignable<T extends U, U> = T
type AssertNoneMissing<T extends never> = T

type _LineFitsType = AssertAssignable<z.output<typeof RolloutLineSchema>, RolloutLine>
type _OriginFitsType = AssertAssignable<z.output<typeof ThreadOriginSchema>, ThreadOrigin>
type _SettingsFitsType = AssertAssignable<z.output<typeof ThreadSettingsSchema>, ThreadSettings>
type _LineTypesComplete = AssertNoneMissing<Exclude<RolloutLine['type'], z.output<typeof RolloutLineSchema>['type']>>
type _ItemTypesComplete = AssertNoneMissing<Exclude<HistoryItem['type'], z.output<typeof HistoryItemSchema>['type']>>
type _PartTypesComplete = AssertNoneMissing<Exclude<ContentPart['type'], z.output<typeof ContentPartSchema>['type']>>
type _OutputTypesComplete = AssertNoneMissing<
  Exclude<ToolOutputContent['type'], z.output<typeof ToolOutputSchema>['type']>
>
type _ChannelsComplete = AssertNoneMissing<Exclude<ChannelKind, (typeof CHANNELS)[number]>>
type _ProfilesComplete = AssertNoneMissing<Exclude<ToolProfile, (typeof PROFILES)[number]>>
type _MentionKindsComplete = AssertNoneMissing<Exclude<MentionKind, (typeof MENTION_KINDS)[number]>>
type _AbortReasonsComplete = AssertNoneMissing<Exclude<TurnAbortedItem['reason'], (typeof ABORT_REASONS)[number]>>
