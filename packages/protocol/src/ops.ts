/**
 * Kernel wire protocol: Ops go in (renderer / gateway → kernel), Events come out. Both are plain
 * JSON so they cross IPC unchanged. This is the ONLY way to drive an agent thread.
 */
import type { ApprovalId, CallId, ItemId, JsonValue, Millis, StepId, ThreadId, TurnId } from './ids'
import type { ContentPart, Mention } from './history'
import type { ToolArtifact, ToolCallStatus, ToolProfile, ToolRisk } from './tools'
import type { ChannelKind } from './gateway'
import type { TokenUsage, ModelError } from './model'
import type { ReasoningEffort } from './config'
import type { TurnSignalEvent, TurnSignalOp } from './turnSignals'
import type { SubagentTrace, ToolSummary, TurnDisplayEvent } from './turnDisplay'

/**
 * Ask (default): reads run; writes ask first unless the user chose 总是允许 for that tool; sends and destructive
 * actions ask every time. Bypass: reads and writes run; sends and destructive actions still ask every time
 * (CLAUDE.md §4.4) — no mode skips them. The authoritative table is APPROVAL_MATRIX in @aiwc/kernel.
 */
export type PermissionMode = 'ask' | 'bypass' | 'autopilot'

/**
 * Coerce anything stored by an older build (notably the removed 'plan' mode) back to a mode that
 * still exists, so an old config.json or thread row degrades instead of being thrown away.
 */
export function normalizePermissionMode(value: unknown): PermissionMode {
  return value === 'bypass' || value === 'autopilot' ? value : 'ask'
}

export interface ThreadSettings {
  permissionMode: PermissionMode
  /** providerId/modelId; undefined = app default */
  model?: { providerId: string; modelId: string }
  /**
   * Reasoning depth for this thread (composer toolbar); undefined / null = the model's own setting in 设置 › AI 接入
   * (null is how a settings patch clears it — undefined does not survive IPC). Ignored when the model lacks the level.
   */
  reasoningEffort?: ReasoningEffort | null
  profile: ToolProfile
  /** Tools the user allowed for this thread via "总是允许". */
  allowAlways: string[]
  title?: string
}

/** The workspace object a desktop thread was opened on (its @ context chip); display and @ context only. */
export interface ThreadContextRef {
  kind: 'session' | 'file' | 'contact'
  id: string
  label: string
}

export interface ThreadOrigin {
  channel: ChannelKind
  /** For wechat channels the chat id the thread is bound to; the bot may only send here. */
  chatId?: string
  peerId?: string
  /**
   * Desktop threads: the workspace object the thread was opened on, stored with the thread so its context chip
   * survives a restart. Never a send target or a data scope — chatId alone plays those roles.
   */
  contextRef?: ThreadContextRef
}

export interface UserInput {
  content: ContentPart[]
  mentions: Mention[]
}

export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny'

/**
 * Where a 总是允许 grant applies: this thread only, or every desktop thread (设置 › AI 接入 › 权限规则 lists and
 * revokes both). Scheduled and WeChat-bound threads never use global grants.
 */
export type GrantScope = 'thread' | 'global'

/** Longest 拒绝并说明 note handed back to the model. */
export const APPROVAL_REASON_MAX_CHARS = 1000

/** Longest focus note a manual compaction (`/compact …`) hands to the summariser. */
export const COMPACT_INSTRUCTIONS_MAX_CHARS = 1000

export type Op =
  | { type: 'thread.create'; threadId: ThreadId; origin: ThreadOrigin; settings: ThreadSettings }
  | {
      type: 'turn.start'
      threadId: ThreadId
      input: UserInput
      mode?: 'start' | 'steer'
      /**
       * Chosen by the sender to recognise its own input when the kernel records it: the matching `item.user` carries
       * it back, so a steer shown as pending can be replaced in place instead of matched by its text.
       */
      clientInputId?: string
    }
  | { type: 'turn.interrupt'; threadId: ThreadId }
  | {
      type: 'approval.resolve'
      threadId: ThreadId
      approvalId: ApprovalId
      decision: ApprovalDecision
      /** 拒绝并说明: what the Agent should do instead; returned to the model with the denial. Only with 'deny'. */
      reason?: string
      /** For 'allow_always': where the grant applies (default 'thread'). */
      scope?: GrantScope
    }
  | { type: 'thread.settings'; threadId: ThreadId; patch: Partial<ThreadSettings> }
  | {
      type: 'thread.compact'
      threadId: ThreadId
      /** `/compact 保留…`: what the summary must keep or focus on (at most COMPACT_INSTRUCTIONS_MAX_CHARS). */
      instructions?: string
    }
  | {
      type: 'thread.rollback'
      threadId: ThreadId
      turns: number
      /**
       * Drop this user message and everything after it (editing or regenerating a turn), instead of counting `turns` from the end.
       * The kernel refuses the op when the item is no longer in the live history (compacted away).
       */
      fromItemId?: ItemId
    }
  | { type: 'thread.clear'; threadId: ThreadId }
  | { type: 'thread.shutdown'; threadId: ThreadId }
  | TurnSignalOp

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
  /** `kind: 'note'` on a turn's events: a host note posted without a model call (no user input, no queue release). */
  | { type: 'turn.started'; threadId: ThreadId; turnId: TurnId; at: Millis; kind?: 'note' }
  | {
      type: 'step.started'
      threadId: ThreadId
      turnId: TurnId
      stepId: StepId
      index: number
      /**
       * Set on the step that rewrites the answer after a blocking Stop hook (e.g. a citation audit): the reply this
       * step produces replaces the turn's earlier answer, which the panel then folds away as superseded work.
       */
      revision?: 'stop_hook'
    }
  | {
      type: 'item.user'
      threadId: ThreadId
      turnId: TurnId
      itemId: ItemId
      content: ContentPart[]
      mentions: Mention[]
      /** The `clientInputId` of the turn.start that delivered this input, when it had one. */
      clientInputId?: string
    }
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
      /** one-line human summary (the kernel's wording; the panel words its own from toolName / input / display) */
      summary: string
      /** The summary as data, when the tool declares one (turnDisplay.ts). */
      display?: ToolSummary
      input: JsonValue
      status: ToolCallStatus
      risk: ToolRisk
      /** Allow-list key this call was judged by (a command prefix for `shell`); absent before validation. */
      allowKey?: string
      startedAt: Millis
      durationMs?: number
      output?: JsonValue | string
      isError?: boolean
      artifacts?: ToolArtifact[]
      /** With the final status: what the call's sub-agents did (the same traces history keeps). */
      subagents?: SubagentTrace[]
    }
  | {
      type: 'tool.progress'
      threadId: ThreadId
      callId: CallId
      message: string
      fraction?: number
      detail?: JsonValue
    }
  | {
      type: 'approval.requested'
      threadId: ThreadId
      turnId: TurnId
      approvalId: ApprovalId
      callId: CallId
      toolName: string
      summary: string
      display?: ToolSummary
      detail?: string
      input: JsonValue
      risk: ToolRisk
      /** destructive tools cannot be allow-always'd */
      canAllowAlways: boolean
      /** What 总是允许 would save: the tool name, or a command prefix such as `shell:git commit`. */
      allowKey?: string
    }
  | {
      type: 'approval.resolved'
      threadId: ThreadId
      approvalId: ApprovalId
      decision: ApprovalDecision
      reason?: string
      scope?: GrantScope
    }
  | { type: 'context.usage'; threadId: ThreadId; usage: ContextUsage }
  | { type: 'context.compacted'; threadId: ThreadId; summaryItemId: ItemId; freedTokens: number }
  | {
      type: 'plan.updated'
      threadId: ThreadId
      steps: Array<{ title: string; status: 'todo' | 'doing' | 'done' | 'failed' }>
    }
  | {
      type: 'turn.completed'
      threadId: ThreadId
      turnId: TurnId
      finalText: string
      usage: TokenUsage
      steps: number
      at: Millis
      kind?: 'note'
    }
  | {
      type: 'turn.aborted'
      threadId: ThreadId
      turnId: TurnId
      reason: 'interrupted' | 'replaced' | 'step_cap' | 'loop_guard' | 'timeout' | 'error'
      /**
       * clientInputIds of input this turn accepted but never recorded (it ended before its prompt reached history:
       * a blocking hook, no usable model, a Stop during pre-turn work). The sender gets it back to resend.
       */
      droppedClientInputIds?: string[]
      kind?: 'note'
    }
  | {
      type: 'error'
      threadId: ThreadId
      turnId?: TurnId
      error: ModelError | { code: string; message: string; retryable?: boolean }
      actions: ErrorAction[]
    }
  | { type: 'memory.written'; threadId: ThreadId; file: string; count: number }
  | { type: 'thread.title'; threadId: ThreadId; title: string }
  | {
      type: 'subagent'
      threadId: ThreadId
      childId: string
      status: 'started' | 'done' | 'failed'
      label: string
      /** The parent's tool call that runs the child (delegate / workflow): the child's work shows under that row. */
      callId?: CallId
      /** The workflow step the child runs. */
      step?: string
    }
  | TurnSignalEvent
  | TurnDisplayEvent

/** An approval or ask_user question still waiting for its answer, as the event that asked it (agent:getThread). */
export type PendingAskEvent = Extract<Event, { type: 'approval.requested' | 'question.requested' }>
