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
import type { ChannelKind, Op, ThreadId, ThreadOrigin, ToolProfile } from '@aiwc/protocol'

export const RENDERER_PROFILES: readonly ToolProfile[] = ['desktop-chat', 'persona']
export const RENDERER_CHANNEL: ChannelKind = 'desktop'

const CHANNELS = ['desktop', 'wechat-ilink', 'wechat-ui', 'cron', 'observed'] as const satisfies readonly ChannelKind[]
const PROFILES = ['desktop-chat', 'wechat-bot', 'cron', 'subagent', 'persona'] as const satisfies readonly ToolProfile[]

const id = z.string().min(1).max(128)
const shortText = z.string().max(2_000)

const contentPart = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('image'), mediaType: shortText, data: z.string(), name: shortText.optional() }),
  z.strictObject({ type: z.literal('file'), mediaType: shortText, data: z.string(), name: shortText }),
])

const mention = z.strictObject({ kind: z.enum(['session', 'file', 'contact', 'memory']), id: shortText, label: shortText })

const userInput = z.strictObject({ content: z.array(contentPart).min(1), mentions: z.array(mention) })

const origin = z.strictObject({ channel: z.enum(CHANNELS), chatId: shortText.optional(), peerId: shortText.optional() })

const settingsFields = {
  permissionMode: z.enum(['ask', 'bypass']),
  model: z.strictObject({ providerId: shortText, modelId: shortText }).optional(),
  profile: z.enum(PROFILES),
  allowAlways: z.array(shortText).max(200),
  title: shortText.optional(),
}
const settings = z.strictObject(settingsFields)
const settingsPatch = z.strictObject(settingsFields).partial()

export const opSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('thread.create'), threadId: id, origin, settings }),
  z.strictObject({ type: z.literal('turn.start'), threadId: id, input: userInput, mode: z.enum(['start', 'steer']).optional() }),
  z.strictObject({ type: z.literal('turn.interrupt'), threadId: id }),
  z.strictObject({ type: z.literal('approval.resolve'), threadId: id, approvalId: id, decision: z.enum(['allow_once', 'allow_always', 'deny']) }),
  z.strictObject({ type: z.literal('thread.settings'), threadId: id, patch: settingsPatch }),
  z.strictObject({ type: z.literal('thread.compact'), threadId: id }),
  z.strictObject({ type: z.literal('thread.rollback'), threadId: id, turns: z.number().int().min(1).max(1_000) }),
  z.strictObject({ type: z.literal('thread.clear'), threadId: id }),
  z.strictObject({ type: z.literal('thread.shutdown'), threadId: id }),
])

/** Ops the renderer may send to any thread, including host-owned bot / cron threads. */
const ALWAYS_ALLOWED: ReadonlySet<Op['type']> = new Set<Op['type']>(['turn.interrupt', 'approval.resolve'])

export type OpViolationCode = 'invalid_op' | 'forbidden_origin' | 'forbidden_profile' | 'forbidden_thread'

export type OpGuardResult = { ok: true; op: Op } | { ok: false; code: OpViolationCode; message: string; threadId?: ThreadId }

export interface OpGuardDeps {
  /** Origin of an existing thread; undefined when unknown (the kernel then rejects the id itself). */
  lookupOrigin(threadId: ThreadId): Promise<ThreadOrigin | undefined>
}

const violation = (code: OpViolationCode, message: string, threadId?: ThreadId): OpGuardResult => ({ ok: false, code, message, threadId })

export async function guardRendererOp(raw: unknown, deps: OpGuardDeps): Promise<OpGuardResult> {
  const parsed = opSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? ` (${first.path.join('.')})` : ''
    const threadId = typeof (raw as { threadId?: unknown } | null)?.threadId === 'string' ? ((raw as { threadId: string }).threadId as ThreadId) : undefined
    return violation('invalid_op', `无效的 Agent 操作${where}`, threadId)
  }
  // zod's inferred type is structurally identical to Op (branded ids are plain strings at runtime).
  const op = parsed.data as unknown as Op

  if (op.type === 'thread.create') {
    if (op.origin.channel !== RENDERER_CHANNEL) return violation('forbidden_origin', '界面只能创建桌面会话', op.threadId)
    if (!RENDERER_PROFILES.includes(op.settings.profile)) return violation('forbidden_profile', `界面不能使用「${op.settings.profile}」工具集`, op.threadId)
    return { ok: true, op }
  }

  if (op.type === 'thread.settings' && op.patch.profile !== undefined && !RENDERER_PROFILES.includes(op.patch.profile)) {
    return violation('forbidden_profile', `界面不能切换到「${op.patch.profile}」工具集`, op.threadId)
  }

  if (ALWAYS_ALLOWED.has(op.type)) return { ok: true, op }

  const target = await deps.lookupOrigin(op.threadId)
  if (target && target.channel !== RENDERER_CHANNEL) {
    const what = op.type === 'thread.settings' && op.patch.permissionMode !== undefined ? '修改权限模式' : '操作'
    return violation('forbidden_thread', `不能从界面${what}由「${target.channel}」通道托管的会话`, op.threadId)
  }
  return { ok: true, op }
}
