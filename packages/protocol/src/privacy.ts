/**
 * Privacy & control contracts: 总是允许 grants (设置 › AI 接入 › 权限规则), the OS permissions auto-send needs, the
 * structured reason an auto-send halt carries, selective Agent-thread export, and the per-turn change journal
 * (what the Agent wrote, and how to undo it).
 */
import { z } from 'zod'
import type { CallId, Millis, ThreadId, TurnId } from './ids'

// ---------------------------------------------------------------------------------------------- grants

/**
 * One 总是允许 grant as the permission-rules page lists it. `key` is a tool name or a `shell:<prefix>` key.
 * `phone` marks a grant answered "2" on the owner's phone (我的微信 › 遥控 thread, origin 'wechat-remote').
 */
export type AgentGrant =
  | { scope: 'global'; key: string }
  | { scope: 'thread'; key: string; threadId: ThreadId; threadTitle: string; phone?: true }

/** Keys are tool names or `<tool>:<command prefix>`; nothing else is ever stored. */
export const GRANT_KEY_RE = /^[a-z][a-z0-9_]{0,63}(?::[^\n\r]{1,200})?$/

// ---------------------------------------------------------------------------------------------- auto-send

/**
 * Why automatic sending stopped (the halt latch). The renderer picks its copy and its action (open the right
 * System Settings pane) from this code, never from the reason text.
 */
export const AUTO_SEND_HALT_CODES = [
  'wrong-session',
  'not-sent',
  'unsupported',
  'no-window',
  'focus-failed',
  'busy',
  'no-permission',
  'automation-denied',
  'other',
] as const
export type AutoSendHaltCode = (typeof AUTO_SEND_HALT_CODES)[number]

/**
 * One OS permission auto-send depends on. `stale`: it was working with an earlier build of the app and the
 * system now refuses it — macOS ties the grant to the exact binary, so after an update the switch still looks
 * on while the check fails; removing and re-adding the app is the fix.
 */
export type OsPermissionState = 'granted' | 'denied' | 'stale' | 'unknown' | 'not-applicable'

export interface AutoSendPermissions {
  platform: 'darwin' | 'win32' | 'linux'
  /** macOS 辅助功能 (Accessibility): needed to type into WeChat. */
  accessibility: OsPermissionState
  /** macOS 自动化 (Apple Events to WeChat / System Events): needed to bring WeChat forward. */
  automation: OsPermissionState
  /** Nothing known blocks auto-send at the OS level. */
  ready: boolean
  checkedAt: Millis
}

// ---------------------------------------------------------------------------------------------- export

export const THREAD_EXPORT_FORMATS = ['md', 'json'] as const

/** 导出会话 options. Every default is the privacy-safe choice. */
export const ThreadExportOptionsSchema = z.object({
  format: z.enum(THREAD_EXPORT_FORMATS).default('md'),
  /** Raw tool outputs carry WeChat chat text; off by default (the call itself is still listed). */
  includeToolOutputs: z.boolean().default(false),
  includeReasoning: z.boolean().default(false),
  /** wxids, group ids, phone numbers, emails, home paths, keys. */
  redactIdentifiers: z.boolean().default(true),
})
export type ThreadExportOptions = z.infer<typeof ThreadExportOptionsSchema>
export const SAFE_THREAD_EXPORT: ThreadExportOptions = ThreadExportOptionsSchema.parse({})

// ---------------------------------------------------------------------------------------------- change journal

export const AGENT_CHANGE_KINDS = ['file', 'memory', 'skill', 'message'] as const
export type AgentChangeKind = (typeof AGENT_CHANGE_KINDS)[number]

/** One thing a tool call changed, listed under the turn that made it. */
export interface AgentChange {
  id: string
  threadId: ThreadId
  turnId: TurnId
  callId: CallId
  toolName: string
  kind: AgentChangeKind
  action: 'created' | 'modified' | 'deleted' | 'added' | 'removed' | 'sent'
  /** Workspace-relative path, memory file name (MEMORY / USER), skill name or recipient. */
  target: string
  /** Short excerpt for memory entries and sent text (bounded); absent for files. */
  excerpt?: string
  at: Millis
  /** Sends can never be undone; a file too large to keep a copy of cannot either. */
  undoable: boolean
  undoneAt?: Millis
}

export type UndoChangeResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'already_undone' | 'not_undoable' | 'conflict' | 'failed' }
