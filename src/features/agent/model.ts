/**
 * Agent panel view model (DESIGN-SPEC §1.3). The kernel speaks in Events / HistoryItems; the
 * panel renders ThreadItems. `reducer.ts` is the only place that turns one into the other.
 */
import type {
  ApprovalId,
  CallId,
  ContentPart,
  ContextUsage,
  ErrorAction,
  Event,
  JsonValue,
  Mention,
  ModelError,
  ThreadId,
  ToolArtifact,
  ToolCallStatus,
  ToolRisk,
  TurnId,
} from '@aiwc/protocol'

export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'failed'
export interface PlanStep {
  title: string
  status: PlanStepStatus
}

/** One row inside a tool-call group. */
export interface ToolCallView {
  callId: CallId
  toolName: string
  /** one-line human summary */
  summary: string
  status: ToolCallStatus
  risk: ToolRisk
  input: JsonValue
  output?: JsonValue | string
  isError?: boolean
  startedAt: number
  durationMs?: number
  artifacts?: ToolArtifact[]
  /** set while an approval popover is anchored to this row */
  approvalId?: ApprovalId
  /** latest tool.progress message */
  progress?: string
  /** rows that are not tool calls but live in the group (sub-agents) */
  kind?: 'tool' | 'subagent'
}

export interface ApprovalRequest {
  approvalId: ApprovalId
  callId: CallId
  turnId: TurnId
  toolName: string
  summary: string
  detail?: string
  input: JsonValue
  risk: ToolRisk
  canAllowAlways: boolean
}

export type ThreadError = ModelError | { code: string; message: string; retryable?: boolean }

export type ThreadItem =
  | { kind: 'user'; id: string; turnId: TurnId; content: ContentPart[]; mentions: Mention[]; createdAt?: number }
  | {
      kind: 'assistant'
      id: string
      turnId: TurnId
      text: string
      reasoning?: string
      streaming: boolean
      modelId?: string
      startedAt?: number
      durationMs?: number
      createdAt?: number
    }
  | { kind: 'tools'; id: string; turnId: TurnId; calls: ToolCallView[] }
  | { kind: 'artifact'; id: string; turnId: TurnId; callId: CallId; artifact: ToolArtifact }
  | { kind: 'plan'; id: string; turnId?: TurnId; steps: PlanStep[] }
  | { kind: 'compaction'; id: string; summaryItemId?: string; freedTokens?: number; summary?: string; foldedItemCount?: number }
  | { kind: 'error'; id: string; turnId?: TurnId; error: ThreadError; actions: ErrorAction[] }
  | { kind: 'aborted'; id: string; turnId: TurnId; reason: Extract<Event, { type: 'turn.aborted' }>['reason'] }

export type ThreadItemKind = ThreadItem['kind']

/** Everything the panel needs to render one thread. Rebuilt from history, then folded by Events. */
export interface ThreadViewState {
  threadId: ThreadId
  items: ThreadItem[]
  usage?: ContextUsage
  isStreaming: boolean
  currentTurnId?: TurnId
  turnStartedAt?: number
  pendingApprovals: ApprovalRequest[]
  /** Suggested prompts for an empty thread (agent:suggestPrompts). */
  suggestions?: string[]
  /** history loaded from agent:getThread */
  loaded: boolean
  loadError?: string
  /** threshold toast already shown for the current high-usage stretch */
  usageWarned?: boolean
}

export interface ComposerDraft {
  text: string
  mentions: Mention[]
}

export const emptyDraft = (): ComposerDraft => ({ text: '', mentions: [] })

/** Draft slot the composer writes to while no thread is open; moved onto the thread on first send. */
export const SCRATCH_DRAFT_KEY = '__scratch__' as ThreadId

export const createThreadView = (threadId: ThreadId, patch: Partial<ThreadViewState> = {}): ThreadViewState => ({
  threadId,
  items: [],
  isStreaming: false,
  pendingApprovals: [],
  loaded: false,
  ...patch,
})

/** Text of a user item (image / file parts become placeholders). */
export function userItemText(content: ContentPart[]): string {
  return content
    .map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? `[图片${p.name ? ` ${p.name}` : ''}]` : `[文件 ${p.name}]`))
    .join('\n')
    .trim()
}

/** Ratio 0–1 (clamped) of the context window in use. */
export function usageRatio(usage: ContextUsage | undefined): number {
  if (!usage || usage.maxTokens <= 0) return 0
  return Math.max(0, Math.min(1, usage.usedTokens / usage.maxTokens))
}

/** 41k / 128k style token count. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** 3.2s / 0.8s / 1m 05s for tool rows and the assistant footer. */
export function formatSeconds(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** Threshold at which the panel suggests compaction (ARCHITECTURE §5.6 default). */
export const USAGE_WARN_RATIO = 0.8
