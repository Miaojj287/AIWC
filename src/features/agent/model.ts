/**
 * Agent panel view model (DESIGN-SPEC §1.3). The kernel speaks in Events / HistoryItems; the
 * panel renders ThreadItems. `reducer.ts` is the only place that turns one into the other.
 */
import type {
  ApprovalId,
  CallId,
  ContentPart,
  ContextUsage,
  DraftAttachment,
  ErrorAction,
  Event,
  GrantScope,
  JsonValue,
  Mention,
  ModelError,
  ThreadId,
  ToolArtifact,
  ToolCallStatus,
  ToolRisk,
  ToolSummary,
  TurnCheck,
  TurnId,
} from '@aiwc/protocol'
import { t } from '@/i18n'
import type { QuestionRequest, TurnSignal } from './turnSignals'

export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'failed'
export interface PlanStep {
  title: string
  status: PlanStepStatus
}

/** One row inside a tool-call group. */
export interface ToolCallView {
  callId: CallId
  toolName: string
  /** The kernel's one-line summary (its own wording); the row words its own — toolSummaries.ts toolCallLabel. */
  summary: string
  /** The summary as data when the tool declared one (a task's name, an MCP server). */
  display?: ToolSummary
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
  /** latest tool.progress structured detail (a workflow's step list), kept after the call ends */
  progressDetail?: JsonValue
  /** rows that are not tool calls but live in the group (sub-agents) */
  kind?: 'tool' | 'subagent'
  /** The model is still writing the arguments: the raw JSON so far (`input` is what parses of it). */
  inputText?: string
  /** Sub-agents this call runs (delegate / workflow steps), live from their events, from the trace after a reload. */
  children?: SubagentRun[]
}

/** One sub-agent under its tool row (subagentRuns.ts). */
export interface SubagentRun {
  childId: string
  label: string
  /** The workflow step it runs. */
  step?: string
  status: 'running' | 'done' | 'failed'
  /** Its own transcript: replies and tool rows. */
  items: ThreadItem[]
  /** The child's running turn (live only). */
  turnId?: TurnId
  /** Older actions left out of a recorded trace. */
  omitted?: number
  startedAt?: number
  durationMs?: number
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
  /** What 总是允许 saves (tool name or command prefix key); the tool name when absent. */
  allowKey?: string
  /** The summary as data (toolSummaries.ts words the request from it). */
  display?: ToolSummary
}

/** Sent with an approval answer: the 拒绝并说明 note, or where a 总是允许 grant applies. */
export interface ApprovalExtra {
  reason?: string
  scope?: GrantScope
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
  | {
      kind: 'compaction'
      id: string
      summaryItemId?: string
      freedTokens?: number
      summary?: string
      foldedItemCount?: number
    }
  | {
      kind: 'error'
      id: string
      turnId?: TurnId
      error: ThreadError
      actions: ErrorAction[]
      /** The turn ended before recording its prompt, which went back into the composer: 重试 sends it again. */
      inputRestored?: boolean
    }
  | { kind: 'aborted'; id: string; turnId: TurnId; reason: Extract<Event, { type: 'turn.aborted' }>['reason'] }
  /** The agent rewrote its answer after a check (Stop-hook audit): replies before this point are a superseded draft. */
  | { kind: 'revision'; id: string; turnId: TurnId }
  /** An automatic check the host ran on the answer (引用核对), shown as a compact system row. */
  | { kind: 'check'; id: string; turnId: TurnId; check: TurnCheck }

/**
 * Input the user sent that the kernel has not recorded yet (pendingInputs.ts): a steer waiting for the current step to
 * end, or the prompt of a turn that is still starting. Its `item.user` (same clientInputId) replaces it.
 */
export interface PendingInput {
  clientInputId: string
  content: ContentPart[]
  mentions: Mention[]
  /** 'steer' joins the running turn after its current step; 'start' opens a new turn. */
  mode: 'start' | 'steer'
  createdAt: number
}

/** Everything the panel needs to render one thread. Rebuilt from history, then folded by Events. */
export interface ThreadViewState {
  threadId: ThreadId
  items: ThreadItem[]
  usage?: ContextUsage
  isStreaming: boolean
  currentTurnId?: TurnId
  turnStartedAt?: number
  pendingApprovals: ApprovalRequest[]
  /** `ask_user` questions waiting for an answer (turnSignals.ts); absent = none. */
  pendingQuestions?: QuestionRequest[]
  /** The running turn is reconnecting or continuing a cut-off answer (turnSignals.ts). */
  turnSignal?: TurnSignal
  /** Sent but not yet recorded by the kernel, oldest first. */
  pendingInputs?: PendingInput[]
  /** A search hit to scroll to once the transcript shows it (cleared by the list when done). */
  focusItemId?: string
  /** history loaded from agent:getThread */
  loaded: boolean
  loadError?: string
  /** threshold toast already shown for the current high-usage stretch */
  usageWarned?: boolean
}

export interface ComposerDraft {
  text: string
  mentions: Mention[]
  /** Pasted / dropped / picked images and files (composer/attachments.ts); sent after the text. */
  attachments?: DraftAttachment[]
}

export const emptyDraft = (): ComposerDraft => ({ text: '', mentions: [] })

/** Draft slot the composer writes to while no thread is open; moved onto the thread on first send. */
export const SCRATCH_DRAFT_KEY = '__scratch__' as ThreadId

/**
 * Untitled threads carry an empty title and the panel shows agent.thread.untitled. Builds before the
 * i18n migration stored the Chinese placeholder instead, so that stored value still counts as untitled.
 */
// eslint-disable-next-line aiwc/no-hardcoded-cjk -- legacy sentinel: the untitled-thread title persisted by older builds, not UI copy
const LEGACY_UNTITLED_TITLE = '新会话'

export const isUntitledTitle = (title: string | undefined): boolean => !title?.trim() || title === LEGACY_UNTITLED_TITLE

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
    .map((p) =>
      p.type === 'text'
        ? p.text
        : p.type === 'image'
          ? p.name
            ? t('agent.message.imageNamed', { name: p.name })
            : t('agent.message.image')
          : t('agent.message.file', { name: p.name }),
    )
    .join('\n')
    .trim()
}

/** The typed text of a user item: text parts only (attachments are drawn as tiles, not as placeholders). */
export function userItemPlainText(content: ContentPart[]): string {
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n')
    .trim()
}

/** Ratio 0–1 (clamped) of the context window in use. */
export function usageRatio(usage: ContextUsage | undefined): number {
  if (!usage || usage.maxTokens <= 0) return 0
  return Math.max(0, Math.min(1, usage.usedTokens / usage.maxTokens))
}

/** 3.2s / 0.8s / 1m 05s for tool rows and the assistant footer. */
export function formatSeconds(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** History fragment kind recorded when a Stop hook sends the model back to rewrite its answer (kernel turn.ts). */
export const STOP_HOOK_FRAGMENT_KIND = 'stop_hook'

/** Threshold at which the panel suggests compaction (ARCHITECTURE §5.6 default). */
export const USAGE_WARN_RATIO = 0.8
