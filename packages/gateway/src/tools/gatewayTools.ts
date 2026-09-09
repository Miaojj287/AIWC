/**
 * Agent-facing send tools. Origin-only is enforced HERE, from ToolContext — never from model input:
 * on any bot channel (wechat-* / observed) `to` is ignored and the message goes back to ctx.origin.chatId.
 *
 * send_media is desktop-only: a WeChat bot thread runs on the raw text of a remote contact, so a tool
 * that reads any local file and uploads it to that contact would be remote file exfiltration
 * (ARCHITECTURE §11). On top of the profile, the file must sit inside the configured media roots.
 */
import { z } from 'zod'
import type { GatewayOutbound, OutboundPart, SendRequest, SessionSource, ToolContext, ToolDefinition, ToolResult } from '@aiwc/protocol'
import { defineTool } from '@aiwc/protocol'
import { checkOutboundMedia, resolveMediaRoots, type MediaRoots } from '../core/mediaPolicy'
import { inferChatType, isBotChannel, sendChannelForOrigin, sourceFromOrigin, withOriginGuard, type Origin } from '../core/originGuard'

export interface GatewayToolServices {
  gateway?: GatewayOutbound
  /** Directories send_media may read from (media cache / exports / user-picked). Injected by the composition root. */
  mediaRoots?: MediaRoots
  [key: string]: unknown
}

export interface DraftHandoff {
  text: string
  origin?: Origin
  threadId: string
}

export interface GatewayToolsOptions {
  /** Where draft_reply hands its text (the reply desk). */
  onDraft?: (draft: DraftHandoff) => void
  /** Channel used for desktop-initiated sends. Default 'wechat-ui' (keyboard injection). */
  desktopSendChannel?: SessionSource['channel']
  /** Fallback for ctx.services.mediaRoots when the composition root passes the roots at construction. */
  mediaRoots?: MediaRoots
}

const SendMessageInput = z.object({
  text: z.string().min(1, '内容不能为空').max(20_000),
  to: z.string().min(1).optional().describe('目标微信会话 id（wxid / xxx@chatroom）。在微信机器人对话里会被忽略，只能回到来源会话。'),
})
type SendMessageInput = z.infer<typeof SendMessageInput>

const SendMediaInput = z.object({
  path: z.string().min(1).describe('本机文件的绝对路径'),
  kind: z.enum(['image', 'file', 'voice']),
  caption: z.string().max(2000).optional(),
  to: z.string().min(1).optional(),
})
type SendMediaInput = z.infer<typeof SendMediaInput>

const DraftReplyInput = z.object({
  text: z.string().min(1, '内容不能为空').max(20_000),
})
type DraftReplyInput = z.infer<typeof DraftReplyInput>

type Target = { ok: true; to: SessionSource } | { ok: false; error: string }

/** Bot context = the turn runs on, or the thread came from, a channel with nobody at the keyboard (wechat-* / observed). */
export const isBotContext = (ctx: Pick<ToolContext, 'channel' | 'origin'>): boolean => isBotChannel(ctx.channel) || isBotChannel(ctx.origin?.channel)

export function resolveTarget(ctx: Pick<ToolContext, 'channel' | 'origin'>, to: string | undefined, desktopChannel: SessionSource['channel']): Target {
  if (isBotContext(ctx)) {
    // `to` is never consulted here: the only legal target is the origin chat.
    const origin = ctx.origin
    if (!origin?.chatId || !isBotChannel(origin.channel)) return { ok: false, error: '来源会话未知，无法发送' }
    return { ok: true, to: sourceFromOrigin({ channel: sendChannelForOrigin(origin.channel), chatId: origin.chatId }) }
  }
  if (!to) return { ok: false, error: '请指定接收会话 to（微信会话 id）' }
  return { ok: true, to: { channel: desktopChannel, chatId: to, peerId: to, chatType: inferChatType(to) } }
}

function pickOutbound(ctx: ToolContext<GatewayToolServices>, fallback: GatewayOutbound): GatewayOutbound {
  const base = ctx.services.gateway ?? fallback
  return withOriginGuard(base, ctx.origin)
}

type MediaPathVerdict = { ok: true; path: string } | { ok: false; error: string }

/**
 * Bot context (thread came from a WeChat chat): the file must be inside the allowed roots and the
 * absence of roots is a refusal. Desktop context: enforced whenever roots are configured; without
 * them the approval popover (which shows the path) is the safeguard.
 */
export function checkMediaPath(ctx: Pick<ToolContext<GatewayToolServices>, 'channel' | 'origin' | 'services'>, filePath: string, fallbackRoots: MediaRoots | undefined): MediaPathVerdict {
  const roots = ctx.services.mediaRoots ?? fallbackRoots
  if (!isBotContext(ctx) && resolveMediaRoots(roots).length === 0) return { ok: true, path: filePath }
  return checkOutboundMedia(filePath, roots)
}

async function deliver(ctx: ToolContext<GatewayToolServices>, fallback: GatewayOutbound, to: SessionSource, parts: OutboundPart[]): Promise<ToolResult> {
  const req: SendRequest = { to, parts, reason: 'agent_tool' }
  const result = await pickOutbound(ctx, fallback).send(req)
  const payload = { ok: result.ok, to: to.chatId, channel: to.channel, messageId: result.messageId ?? null, verified: result.verified ?? null, error: result.error ?? null }
  return { content: payload, isError: !result.ok }
}

// `any` mirrors the frozen PACKAGE-API signature: the registry accepts heterogeneous input types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gatewayTools(outbound: GatewayOutbound, opts: GatewayToolsOptions = {}): ToolDefinition<any, GatewayToolServices>[] {
  const desktopChannel = opts.desktopSendChannel ?? 'wechat-ui'

  const sendMessage = defineTool<SendMessageInput, GatewayToolServices>({
    name: 'send_message',
    description: '向微信会话发送一段文字。在微信机器人对话里只能回到当前来源会话；桌面端需指定 to。用 ---wx-next--- 单独成行可拆成多条气泡。',
    inputSchema: SendMessageInput,
    profiles: ['desktop-chat', 'wechat-bot'],
    risk: 'send',
    parallelSafe: false,
    timeoutMs: 60_000,
    summarize: (i) => `发送消息${i.to ? `到 ${i.to}` : ''}：${i.text.slice(0, 40)}${i.text.length > 40 ? '…' : ''}`,
    async execute(input, ctx) {
      const target = resolveTarget(ctx, input.to, desktopChannel)
      if (!target.ok) return { content: { ok: false, error: target.error }, isError: true }
      return deliver(ctx, outbound, target.to, [{ type: 'text', text: input.text }])
    },
  })

  const sendMedia = defineTool<SendMediaInput, GatewayToolServices>({
    name: 'send_media',
    description: '向微信会话发送本机图片 / 文件 / 语音（仅限允许目录内的文件）。规则与 send_message 相同：机器人对话只能回到来源会话。',
    inputSchema: SendMediaInput,
    // Never 'wechat-bot': see the file header.
    profiles: ['desktop-chat'],
    risk: 'send',
    parallelSafe: false,
    timeoutMs: 120_000,
    summarize: (i) => `发送${i.kind === 'image' ? '图片' : i.kind === 'voice' ? '语音' : '文件'}：${i.path}`,
    async execute(input, ctx) {
      const target = resolveTarget(ctx, input.to, desktopChannel)
      if (!target.ok) return { content: { ok: false, error: target.error }, isError: true }
      const checked = checkMediaPath(ctx, input.path, opts.mediaRoots)
      if (!checked.ok) return { content: { ok: false, error: checked.error }, isError: true }
      const path = checked.path
      const media: OutboundPart = input.kind === 'image' ? { type: 'image', path } : input.kind === 'voice' ? { type: 'voice', path } : { type: 'file', path }
      const parts: OutboundPart[] = input.caption?.trim() ? [media, { type: 'text', text: input.caption.trim() }] : [media]
      return deliver(ctx, outbound, target.to, parts)
    },
  })

  const draftReply = defineTool<DraftReplyInput, GatewayToolServices>({
    name: 'draft_reply',
    description: '把一条回复草稿交给回复台，由用户确认后再发送；不会直接发出任何消息。',
    inputSchema: DraftReplyInput,
    profiles: ['wechat-bot', 'cron'],
    risk: 'read',
    parallelSafe: true,
    summarize: (i) => `起草回复：${i.text.slice(0, 40)}${i.text.length > 40 ? '…' : ''}`,
    async execute(input, ctx) {
      const origin: Origin | undefined = ctx.origin ? { channel: ctx.origin.channel, chatId: ctx.origin.chatId } : undefined
      opts.onDraft?.({ text: input.text, origin, threadId: String(ctx.threadId) })
      return { content: { drafted: true, text: input.text, to: origin?.chatId ?? null } }
    },
  })

  return [sendMessage, sendMedia, draftReply]
}
