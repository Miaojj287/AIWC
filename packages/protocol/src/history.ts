/**
 * Canonical conversation history items. The kernel stores THESE (not AI SDK messages);
 * the model adapter converts them per request. Every item is bounded and append-only —
 * see docs/ARCHITECTURE.md §5 "Context rules".
 */
import type { CallId, ItemId, Millis, StepId, TurnId, JsonValue } from './ids'
import type { ToolArtifact } from './tools'
import type { SubagentTrace, ToolSummary, TurnCheck } from './turnDisplay'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; /** base64 */ name?: string }
  | { type: 'file'; mediaType: string; data: string; name: string }

export type MentionKind = 'session' | 'file' | 'contact' | 'memory'
export interface Mention {
  kind: MentionKind
  id: string
  label: string
  /**
   * 引用到 Agent with picked messages: ids within the session `id` (at most MAX_QUOTED_MESSAGES). The host injects
   * their text into the turn; without it the mention refers to the whole chat.
   */
  messageIds?: string[]
}

/** Messages one quote may carry: enough for a discussion, bounded for the prompt. */
export const MAX_QUOTED_MESSAGES = 50

export interface UserMessageItem {
  type: 'user_message'
  id: ItemId
  turnId: TurnId
  createdAt: Millis
  content: ContentPart[]
  mentions: Mention[]
}

export interface AssistantMessageItem {
  type: 'assistant_message'
  id: ItemId
  turnId: TurnId
  stepId: StepId
  createdAt: Millis
  text: string
  reasoning?: string
  modelId?: string
}

export interface ToolCallItem {
  type: 'tool_call'
  id: ItemId
  turnId: TurnId
  stepId: StepId
  createdAt: Millis
  callId: CallId
  toolName: string
  input: JsonValue
  /** The summary as data (turnDisplay.ts), when the tool declares one; older rollouts have none. */
  display?: ToolSummary
}

export type ToolOutputContent =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }
  | { type: 'image'; mediaType: string; data: string }

export interface ToolResultItem {
  type: 'tool_result'
  id: ItemId
  turnId: TurnId
  stepId: StepId
  createdAt: Millis
  callId: CallId
  toolName: string
  output: ToolOutputContent
  isError: boolean
  durationMs: number
  /** True when the output was cut at record time to respect the per-item cap. */
  truncated: boolean
  /** Files the call produced (path-based only), kept so the transcript can still offer them; never sent to the model. */
  artifacts?: ToolArtifact[]
  /** What the call's sub-agents did (delegate / workflow), for the transcript only; never sent to the model. */
  subagents?: SubagentTrace[]
}

/** A typed, bounded context injection (memory snapshot, environment, observed messages…). */
export interface ContextFragmentItem {
  type: 'context_fragment'
  id: ItemId
  turnId: TurnId | null
  createdAt: Millis
  kind: string
  marker: string
  text: string
  tokenEstimate: number
}

export interface CompactionSummaryItem {
  type: 'compaction_summary'
  id: ItemId
  createdAt: Millis
  summary: string
  foldedItemCount: number
  /** id of the last item folded into this summary */
  foldedThroughId: ItemId
  tokenEstimate: number
}

export interface TurnAbortedItem {
  type: 'turn_aborted'
  id: ItemId
  turnId: TurnId
  createdAt: Millis
  reason: 'interrupted' | 'replaced' | 'error' | 'step_cap' | 'loop_guard' | 'timeout'
}

/**
 * An automatic check the host ran on the turn's answer (a citation audit), recorded so the transcript can show it
 * after a reload. Display only: never sent to the model, worth no tokens.
 */
export interface TurnCheckItem {
  type: 'turn_check'
  id: ItemId
  turnId: TurnId
  createdAt: Millis
  check: TurnCheck
}

export type HistoryItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolCallItem
  | ToolResultItem
  | ContextFragmentItem
  | CompactionSummaryItem
  | TurnAbortedItem
  | TurnCheckItem
