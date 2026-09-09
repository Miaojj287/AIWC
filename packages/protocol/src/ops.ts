/**
 * Kernel wire protocol: Ops go in (renderer / gateway → kernel), Events come out. Both are plain
 * JSON so they cross IPC unchanged. This is the ONLY way to drive an agent thread.
 */
import type { ApprovalId, CallId, ItemId, JsonValue, Millis, StepId, ThreadId, TurnId } from './ids'
import type { ContentPart, Mention } from './history'
import type { ToolArtifact, ToolCallStatus, ToolProfile, ToolRisk } from './tools'
import type { ChannelKind } from './gateway'
import type { TokenUsage, ModelError } from './model'

/**
 * Ask = 高危动作（对外发送 / 破坏性）才确认，读写照常；Bypass = 读写全部放行，仍然只在高危动作前确认。
 * 对外发送和破坏性操作永远要人确认（CLAUDE.md §4.4），任何模式都不能跳过。
 */
export type PermissionMode = 'ask' | 'bypass'

export const PERMISSION_MODES: readonly PermissionMode[] = ['ask', 'bypass']

/**
 * Coerce anything stored by an older build (notably the removed 'plan' mode) back to a mode that
 * still exists, so an old config.json or thread row degrades instead of being thrown away.
 */
export function normalizePermissionMode(value: unknown): PermissionMode {
  return value === 'bypass' ? 'bypass' : 'ask'
}

export interface ThreadSettings {
  permissionMode: PermissionMode
  /** providerId/modelId; undefined = app default */
  model?: { providerId: string; modelId: string }
  profile: ToolProfile
  /** Tools the user allowed for this thread via "总是允许". */
  allowAlways: string[]
  title?: string
}

export interface ThreadOrigin {
  channel: ChannelKind
  /** For wechat channels the chat id the thread is bound to; the bot may only send here. */
  chatId?: string
  peerId?: string
}

export interface UserInput {
  content: ContentPart[]
  mentions: Mention[]
}

export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny'

export type Op =
  | { type: 'thread.create'; threadId: ThreadId; origin: ThreadOrigin; settings: ThreadSettings }
  | { type: 'turn.start'; threadId: ThreadId; input: UserInput; mode?: 'start' | 'steer' }
  | { type: 'turn.interrupt'; threadId: ThreadId }
  | { type: 'approval.resolve'; threadId: ThreadId; approvalId: ApprovalId; decision: ApprovalDecision }
  | { type: 'thread.settings'; threadId: ThreadId; patch: Partial<ThreadSettings> }
  | { type: 'thread.compact'; threadId: ThreadId }
  | { type: 'thread.rollback'; threadId: ThreadId; turns: number }
  | { type: 'thread.clear'; threadId: ThreadId }
  | { type: 'thread.shutdown'; threadId: ThreadId }

export interface ContextUsage {
  usedTokens: number
  maxTokens: number
  breakdown: { system: number; memory: number; references: number; history: number; tools: number }
}

export interface ErrorAction {
  label: string
  action: 'open_settings_ai' | 'retry' | 'compact' | 'open_settings_account' | 'dismiss'
}

export type Event =
  | { type: 'thread.created'; threadId: ThreadId; settings: ThreadSettings; origin: ThreadOrigin }
  | { type: 'thread.settings'; threadId: ThreadId; settings: ThreadSettings }
  | { type: 'turn.started'; threadId: ThreadId; turnId: TurnId; at: Millis }
  | { type: 'step.started'; threadId: ThreadId; turnId: TurnId; stepId: StepId; index: number }
  | { type: 'item.user'; threadId: ThreadId; turnId: TurnId; itemId: ItemId; content: ContentPart[]; mentions: Mention[] }
  | { type: 'text.start'; threadId: ThreadId; turnId: TurnId; itemId: ItemId }
  | { type: 'text.delta'; threadId: ThreadId; turnId: TurnId; itemId: ItemId; delta: string }
  | { type: 'text.end'; threadId: ThreadId; turnId: TurnId; itemId: ItemId; text: string }
  | { type: 'reasoning.delta'; threadId: ThreadId; turnId: TurnId; itemId: ItemId; delta: string }
  | {
      type: 'tool.call'
      threadId: ThreadId
      turnId: TurnId
      stepId: StepId
      callId: CallId
      toolName: string
      /** one-line human summary */
      summary: string
      input: JsonValue
      status: ToolCallStatus
      risk: ToolRisk
      startedAt: Millis
      durationMs?: number
      output?: JsonValue | string
      isError?: boolean
      artifacts?: ToolArtifact[]
    }
  | { type: 'tool.progress'; threadId: ThreadId; callId: CallId; message: string; fraction?: number }
  | {
      type: 'approval.requested'
      threadId: ThreadId
      turnId: TurnId
      approvalId: ApprovalId
      callId: CallId
      toolName: string
      summary: string
      detail?: string
      input: JsonValue
      risk: ToolRisk
      /** destructive tools cannot be allow-always'd */
      canAllowAlways: boolean
    }
  | { type: 'approval.resolved'; threadId: ThreadId; approvalId: ApprovalId; decision: ApprovalDecision }
  | { type: 'context.usage'; threadId: ThreadId; usage: ContextUsage }
  | { type: 'context.compacted'; threadId: ThreadId; summaryItemId: ItemId; freedTokens: number }
  | { type: 'plan.updated'; threadId: ThreadId; steps: Array<{ title: string; status: 'todo' | 'doing' | 'done' | 'failed' }> }
  | { type: 'turn.completed'; threadId: ThreadId; turnId: TurnId; finalText: string; usage: TokenUsage; steps: number; at: Millis }
  | { type: 'turn.aborted'; threadId: ThreadId; turnId: TurnId; reason: 'interrupted' | 'replaced' | 'step_cap' | 'loop_guard' | 'timeout' | 'error' }
  | { type: 'error'; threadId: ThreadId; turnId?: TurnId; error: ModelError | { code: string; message: string; retryable?: boolean }; actions: ErrorAction[] }
  | { type: 'memory.written'; threadId: ThreadId; file: string; count: number }
  | { type: 'thread.title'; threadId: ThreadId; title: string }
  | { type: 'subagent'; threadId: ThreadId; childId: string; status: 'started' | 'done' | 'failed'; label: string }

export type EventType = Event['type']
