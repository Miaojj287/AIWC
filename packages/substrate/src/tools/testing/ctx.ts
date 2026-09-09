/**
 * Minimal ToolContext factory for tests.
 */
import type { StepId, SubstrateService, ToolContext, ToolProfile, ToolResult } from '@aiwc/protocol'
import { asCallId, asThreadId, asTurnId } from '@aiwc/protocol'
import type { SubstrateToolServices } from '../shared'

export type CtxOverrides = Partial<Pick<ToolContext<SubstrateToolServices>, 'profile' | 'signal' | 'progress' | 'depth' | 'origin' | 'channel'>>

export function makeCtx(substrate: SubstrateService, overrides: CtxOverrides = {}): ToolContext<SubstrateToolServices> {
  const profile: ToolProfile = overrides.profile ?? 'desktop-chat'
  const ctx: ToolContext<SubstrateToolServices> = {
    threadId: asThreadId('thr_test'),
    turnId: asTurnId('trn_test'),
    stepId: 'stp_test' as StepId,
    callId: asCallId('cal_test'),
    channel: overrides.channel ?? 'desktop',
    profile,
    signal: overrides.signal ?? new AbortController().signal,
    services: { substrate },
    progress: overrides.progress ?? (() => {}),
    depth: overrides.depth ?? 0,
  }
  if (overrides.origin) ctx.origin = overrides.origin
  return ctx
}

/** A wechat-bot context bound to `chatId` (pass undefined to simulate an unknown origin). */
export function botCtxOverrides(chatId: string | undefined): CtxOverrides {
  const base: CtxOverrides = { profile: 'wechat-bot', channel: 'wechat-ilink' }
  if (chatId !== undefined) base.origin = { channel: 'wechat-ilink', chatId }
  return base
}

/** Parse through the tool's own schema (applies defaults) — mirrors what the kernel does before execute. */
export function parseInput<I>(schema: { parse(v: unknown): I }, raw: unknown): I {
  return schema.parse(raw)
}

/** Validate through the tool's schema, then execute — the same two steps the kernel's dispatch performs. */
export async function runTool<I>(
  tool: { inputSchema: { parse(v: unknown): I }; execute(input: I, ctx: ToolContext<SubstrateToolServices>): Promise<ToolResult> },
  raw: unknown,
  substrate: SubstrateService,
  ctxOverrides?: CtxOverrides,
) {
  const input = tool.inputSchema.parse(raw)
  return tool.execute(input, makeCtx(substrate, ctxOverrides))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function body<T = Record<string, any>>(res: { content: unknown }): T {
  return res.content as T
}
