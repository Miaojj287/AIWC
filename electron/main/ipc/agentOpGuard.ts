/**
 * Renderer-facing guard for `agent:submit`. The kernel trusts its callers, so the IPC boundary is the
 * place that (1) validates the Op shape (zod, strict) and (2) limits what the renderer may drive:
 *   - thread.create only for origin.channel 'desktop' and a renderer profile (desktop-chat / persona)
 *   - every op that targets an existing thread must target a desktop thread — bot / cron threads are
 *     host-owned — except turn.interrupt and approval.resolve (the user may always stop or answer)
 *   - thread.settings may not switch a thread to a non-renderer profile
 * Pure module (no electron import) so it is unit-testable.
 */
import { z } from 'zod'
import {
  APPROVAL_REASON_MAX_CHARS,
  checkAttachments,
  COMPACT_INSTRUCTIONS_MAX_CHARS,
  MAX_QUOTED_MESSAGES,
  PermissionModeSchema,
  QUESTION_MAX_OPTIONS,
  ReasoningEffortSchema,
  type AttachmentPart,
  type ChannelKind,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ToolProfile,
} from '@aiwc/protocol'
import { t } from '../i18n'

export const RENDERER_PROFILES: readonly ToolProfile[] = ['desktop-chat', 'persona']
export const RENDERER_CHANNEL: ChannelKind = 'desktop'

const CHANNELS = ['desktop', 'wechat-ilink', 'wechat-ui', 'cron', 'observed'] as const satisfies readonly ChannelKind[]
const PROFILES = ['desktop-chat', 'wechat-bot', 'cron', 'subagent', 'persona'] as const satisfies readonly ToolProfile[]

const id = z.string().min(1).max(128)
const shortText = z.string().max(2_000)

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)
const contentPart = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('image'), mediaType: shortText, data: base64, name: shortText.optional() }),
  z.strictObject({ type: z.literal('file'), mediaType: shortText, data: base64, name: shortText }),
])

const mention = z.strictObject({
  kind: z.enum(['session', 'file', 'contact', 'memory']),
  id: shortText,
  label: shortText,
  messageIds: z.array(id).max(MAX_QUOTED_MESSAGES).optional(),
})

// Attachment count / size limits are the composer's (checkAttachments); a renderer that skips them stops here.
const userInput = z
  .strictObject({ content: z.array(contentPart).min(1), mentions: z.array(mention) })
  .superRefine((input, ctx) => {
    const violation = checkAttachments(input.content.filter((p): p is AttachmentPart => p.type !== 'text'))
    if (violation) ctx.addIssue({ code: 'custom', path: ['content'], message: violation.code })
  })

/** An answer to `ask_user`: a numbered option, free text (其他), or no answer. */
const questionAnswer = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('option'),
    index: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_MAX_OPTIONS - 1),
    label: shortText,
  }),
  z.strictObject({ kind: z.literal('other'), text: z.string().trim().min(1).max(2_000) }),
  z.strictObject({ kind: z.literal('dismissed') }),
])

const contextRef = z.strictObject({ kind: z.enum(['session', 'file', 'contact']), id: shortText, label: shortText })

const origin = z.strictObject({
  channel: z.enum(CHANNELS),
  chatId: shortText.optional(),
  peerId: shortText.optional(),
  contextRef: contextRef.optional(),
})

const settingsFields = {
  permissionMode: PermissionModeSchema,
  model: z.strictObject({ providerId: shortText, modelId: shortText }).optional(),
  reasoningEffort: ReasoningEffortSchema.nullable().optional(),
  profile: z.enum(PROFILES),
  allowAlways: z.array(shortText).max(200),
  title: shortText.optional(),
}
const settings = z.strictObject(settingsFields)
const settingsPatch = z.strictObject(settingsFields).partial()

export const opSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('thread.create'), threadId: id, origin, settings }),
  z.strictObject({
    type: z.literal('turn.start'),
    threadId: id,
    input: userInput,
    mode: z.enum(['start', 'steer']).optional(),
    clientInputId: z.string().min(1).max(64).optional(),
  }),
  z.strictObject({ type: z.literal('turn.interrupt'), threadId: id }),
  z.strictObject({
    type: z.literal('approval.resolve'),
    threadId: id,
    approvalId: id,
    decision: z.enum(['allow_once', 'allow_always', 'deny']),
    reason: z.string().max(APPROVAL_REASON_MAX_CHARS).optional(),
    scope: z.enum(['thread', 'global']).optional(),
  }),
  z.strictObject({ type: z.literal('thread.settings'), threadId: id, patch: settingsPatch }),
  z.strictObject({
    type: z.literal('thread.compact'),
    threadId: id,
    instructions: z.string().max(COMPACT_INSTRUCTIONS_MAX_CHARS).optional(),
  }),
  z.strictObject({
    type: z.literal('thread.rollback'),
    threadId: id,
    turns: z.number().int().min(1).max(1_000),
    fromItemId: id.optional(),
  }),
  z.strictObject({ type: z.literal('thread.clear'), threadId: id }),
  z.strictObject({ type: z.literal('thread.shutdown'), threadId: id }),
  z.strictObject({ type: z.literal('question.answer'), threadId: id, questionId: id, answer: questionAnswer }),
])

/** Ops the renderer may send to any thread, including host-owned bot / cron threads. */
const ALWAYS_ALLOWED: ReadonlySet<Op['type']> = new Set<Op['type']>(['turn.interrupt', 'approval.resolve'])

export type OpViolationCode = 'invalid_op' | 'forbidden_origin' | 'forbidden_profile' | 'forbidden_thread'

export type OpGuardResult =
  { ok: true; op: Op } | { ok: false; code: OpViolationCode; message: string; threadId?: ThreadId }

export interface OpGuardDeps {
  /** Origin of an existing thread; undefined when unknown (the kernel then rejects the id itself). */
  lookupOrigin(threadId: ThreadId): Promise<ThreadOrigin | undefined>
}

const violation = (code: OpViolationCode, message: string, threadId?: ThreadId): OpGuardResult => ({
  ok: false,
  code,
  message,
  threadId,
})

export async function guardRendererOp(raw: unknown, deps: OpGuardDeps): Promise<OpGuardResult> {
  const parsed = opSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? ` (${first.path.join('.')})` : ''
    const threadId =
      typeof (raw as { threadId?: unknown } | null)?.threadId === 'string'
        ? ((raw as { threadId: string }).threadId as ThreadId)
        : undefined
    return violation('invalid_op', t('main.agent.guard.invalidOp', { where }), threadId)
  }
  // zod's inferred type is structurally identical to Op (branded ids are plain strings at runtime).
  const op = parsed.data as unknown as Op

  if (op.type === 'thread.create') {
    if (op.origin.channel !== RENDERER_CHANNEL)
      return violation('forbidden_origin', t('main.agent.guard.desktopOnly'), op.threadId)
    if (!RENDERER_PROFILES.includes(op.settings.profile))
      return violation(
        'forbidden_profile',
        t('main.agent.guard.forbiddenProfile', { profile: op.settings.profile }),
        op.threadId,
      )
    return { ok: true, op }
  }

  if (
    op.type === 'thread.settings' &&
    op.patch.profile !== undefined &&
    !RENDERER_PROFILES.includes(op.patch.profile)
  ) {
    return violation(
      'forbidden_profile',
      t('main.agent.guard.forbiddenProfileSwitch', { profile: op.patch.profile }),
      op.threadId,
    )
  }

  if (ALWAYS_ALLOWED.has(op.type)) return { ok: true, op }

  const target = await deps.lookupOrigin(op.threadId)
  if (target && target.channel !== RENDERER_CHANNEL) {
    const action =
      op.type === 'thread.settings' && op.patch.permissionMode !== undefined
        ? t('main.agent.guard.actionPermissionMode')
        : t('main.agent.guard.actionGeneric')
    return violation(
      'forbidden_thread',
      t('main.agent.guard.forbiddenThread', { action, channel: target.channel }),
      op.threadId,
    )
  }
  return { ok: true, op }
}
