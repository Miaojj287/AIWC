/**
 * wechat-bot read scoping. A bot thread's reply goes straight back to the peer it is bound to, so a
 * read tool mounted on the 'wechat-bot' profile may only read that peer's own chat
 * (ctx.origin.chatId) — otherwise a contact could ask the bot to pull the owner's other
 * conversations and have the summary auto-sent to them. Tools that enumerate the owner's contact
 * graph or scan across sessions are not mounted on the bot at all (READ_PROFILES_NO_BOT) and refuse
 * at runtime as well, in case a registry ever mounts them.
 *
 * Detection keys off the profile (same rule as the kernel registry and relationship tools): the bot
 * profile can never reach `subagent` (delegate_analysis is desktop-only), so this is sufficient.
 */
import type { ToolContext, ToolResult } from '@aiwc/protocol'
import { fail } from './shared'

type ScopeContext = Pick<ToolContext, 'profile' | 'origin'>

export type BotScope<T> = { ok: true; value: T } | { ok: false; result: ToolResult }

export const BOT_NO_ORIGIN_MESSAGE = '机器人线程缺少来源会话，无法读取聊天数据。'
export const BOT_TOOL_REFUSED_MESSAGE = '该工具不对微信机器人开放：机器人只能读取当前会话的聊天数据。'

export function isBotContext(ctx: ScopeContext): boolean {
  return ctx.profile === 'wechat-bot'
}

/** The chat a bot thread is bound to; undefined for non-bot profiles or when the origin is unknown. */
export function botOriginChatId(ctx: ScopeContext): string | undefined {
  if (!isBotContext(ctx)) return undefined
  const id = ctx.origin?.chatId?.trim()
  return id ? id : undefined
}

/**
 * Resolve the session list a tool may read. Non-bot profiles pass through untouched. Under the bot:
 * no ids → forced to the origin chat; ids given → every one must be the origin chat, otherwise the
 * call is refused (never silently narrowed, so the model cannot mistake origin-only results for
 * another session's).
 */
export function scopeBotSessions(ctx: ScopeContext, requested: readonly string[] | undefined): BotScope<string[] | undefined> {
  if (!isBotContext(ctx)) return { ok: true, value: requested ? [...requested] : undefined }
  const origin = botOriginChatId(ctx)
  if (!origin) return { ok: false, result: fail(BOT_NO_ORIGIN_MESSAGE) }
  const refused = [...new Set((requested ?? []).map((s) => s.trim()).filter((s) => s && s !== origin))]
  if (refused.length > 0) {
    return { ok: false, result: fail(`机器人只能读取当前会话（${origin}）的聊天数据，不能访问其它会话。`, { origin, refused }) }
  }
  return { ok: true, value: [origin] }
}

/** Single-session variant of scopeBotSessions (sessionId / groupId / anchor.sessionId). */
export function scopeBotSession(ctx: ScopeContext, requested: string | undefined): BotScope<string | undefined> {
  const scoped = scopeBotSessions(ctx, requested === undefined ? undefined : [requested])
  if (!scoped.ok) return scoped
  return { ok: true, value: scoped.value?.[0] }
}

/** For tools that must never serve the bot (enumeration / cross-session scans): a refusal, or undefined to proceed. */
export function refuseForBot(ctx: ScopeContext): ToolResult | undefined {
  return isBotContext(ctx) ? fail(BOT_TOOL_REFUSED_MESSAGE) : undefined
}
