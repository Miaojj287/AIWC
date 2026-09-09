/**
 * Canonical conversation history items. The kernel stores THESE (not AI SDK messages);
 * the model adapter converts them per request. Every item is bounded and append-only —
 * see docs/ARCHITECTURE.md §5 "Context rules".
 */
import type { CallId, ItemId, Millis, StepId, TurnId, JsonValue } from './ids'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; /** base64 */ name?: string }
  | { type: 'file'; mediaType: string; data: string; name: string }

export type MentionKind = 'session' | 'file' | 'contact' | 'memory'
export interface Mention {
  kind: MentionKind
  id: string
  label: string
}

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

export type HistoryItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolCallItem
  | ToolResultItem
  | ContextFragmentItem
  | CompactionSummaryItem
  | TurnAbortedItem

export type HistoryItemType = HistoryItem['type']

/** Items that are model-visible but should NOT show in the user-facing transcript. */
export const isInternalItem = (item: HistoryItem): boolean =>
  item.type === 'context_fragment' || item.type === 'compaction_summary' || item.type === 'turn_aborted'
