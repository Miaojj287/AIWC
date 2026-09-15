/**
 * Tool contract. Tools are plain objects created with defineTool(); the kernel owns the registry,
 * approval, dispatch, timeouts and truncation. Packages (substrate / memory / gateway) export tool
 * definitions without depending on the kernel.
 */
import type { z } from 'zod'
import type { CallId, JsonValue, StepId, ThreadId, TurnId } from './ids'
import type { ChannelKind } from './gateway'

/**
 * Risk drives approval: read = never asks, write = asks unless allow-listed (free in Bypass),
 * send = outward-facing (WeChat send / push) → always confirm in Ask and Bypass,
 * destructive = delete / clear → always confirm, never allow-always.
 */
export type ToolRisk = 'read' | 'write' | 'send' | 'destructive'

/**
 * Profiles are the mounting surface: a tool is visible to the model only when the current
 * profile is listed. 'wechat-bot' must never receive write/destructive tools except send-to-origin.
 */
export type ToolProfile = 'desktop-chat' | 'wechat-bot' | 'cron' | 'subagent' | 'persona'

export type ToolExposure = 'direct' | 'hidden'

export interface ToolProgress {
  (message: string, fraction?: number): void
}

/** Open bag of services the composition root wires. Tools pick the fields they need. */
export interface ToolServices {
  [key: string]: unknown
}

export interface ToolContext<S extends ToolServices = ToolServices> {
  threadId: ThreadId
  turnId: TurnId
  stepId: StepId
  callId: CallId
  channel: ChannelKind
  profile: ToolProfile
  /** The session the current turn originated from (wechat user / desktop). */
  origin?: { channel: ChannelKind; chatId: string }
  signal: AbortSignal
  services: S
  progress: ToolProgress
  /** Depth 0 = main agent, 1 = subagent. */
  depth: number
}

export interface ToolArtifact {
  kind: 'file' | 'markdown' | 'image'
  title: string
  path?: string
  content?: string
  mediaType?: string
}

export interface ToolResult {
  content: string | JsonValue
  isError?: boolean
  artifacts?: ToolArtifact[]
  /** Free-form metadata surfaced to the UI (e.g. evidence anchors), never sent to the model. */
  meta?: Record<string, JsonValue>
}

/**
 * A tool of any input and services type, for heterogeneous collections (registry, router, tool lists).
 * `any` is deliberate and confined here: `ToolDefinition<I, S>` is contravariant in both parameters, so no
 * concrete instantiation can hold every tool.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>

/**
 * Per-call approval policy for tools whose danger depends on the input (a shell command, a CLI call).
 * `risk` replaces the definition's static risk for this call; `allowKey` is what "总是允许" persists
 * instead of the tool name, so the allow-list can be as narrow as a command prefix
 * (`shell:git commit`) rather than "any command".
 */
export interface ToolCallPolicy {
  risk: ToolRisk
  allowKey?: string
  /** False forces a fresh confirmation every time even when the risk would allow "总是允许". */
  canAllowAlways?: boolean
  /** One sentence shown with the approval, e.g. why a command was classified as destructive. */
  note?: string
}

export interface ToolDefinition<I = unknown, S extends ToolServices = ToolServices> {
  name: string
  description: string
  inputSchema: z.ZodType<I>
  profiles: readonly ToolProfile[]
  /** Static risk; `classify` may raise or lower it per call. */
  risk: ToolRisk
  /** Called after validation, before approval; the returned risk / allow-list key govern this call. */
  classify?: (input: I) => ToolCallPolicy
  /** Safe to run concurrently with other parallel-safe tools (read-only, no shared mutable state). */
  parallelSafe: boolean
  exposure?: ToolExposure
  timeoutMs?: number
  /** Output cap before truncation at record time. Default: kernel policy (16k chars). */
  maxOutputChars?: number
  /** One-line human summary for approval popovers, e.g. (i) => `发送到 ${i.to}`. */
  summarize?: (input: I) => string
  execute(input: I, ctx: ToolContext<S>): Promise<ToolResult>
}

export function defineTool<I, S extends ToolServices = ToolServices>(def: ToolDefinition<I, S>): ToolDefinition<I, S> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(def.name)) throw new Error(`invalid tool name: ${def.name}`)
  return def
}

/** What the model sees. Produced by the kernel from a ToolDefinition. */
export interface ToolSpecForModel {
  name: string
  description: string
  inputJsonSchema: Record<string, unknown>
}

export type ToolCallStatus = 'pending' | 'awaiting_approval' | 'running' | 'done' | 'error' | 'denied' | 'timeout'
