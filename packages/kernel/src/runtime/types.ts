/**
 * Public runtime types: the Kernel façade (docs/PACKAGE-API.md) plus small shared helpers used
 * across thread / turn / step.
 */
import type {
  CallId,
  ChannelKind,
  Event,
  HistoryItem,
  ItemId,
  Op,
  PendingAskEvent,
  PermissionMode,
  SubagentTrace,
  ThreadId,
  ThreadOrigin,
  ThreadSettings,
  ToolArtifact,
  ToolProfile,
  TurnId,
  UserInput,
} from '@aiwc/protocol'
import type { KernelServices, RolloutSearchHit, ThreadRecord } from '../ports'
import type { ResilientSampleOptions } from './model/resilientSample'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type Logger = (level: LogLevel, msg: string, meta?: unknown) => void

/**
 * The stable tier. `byProfile` fully REPLACES `stable` for that profile — the persona profile needs
 * the opposite identity to the agent's ("你就是这个人" vs "你不冒充用户本人"), so layering the two
 * would leave the model with contradictory instructions.
 */
export interface SystemPromptConfig {
  stable: string
  byProfile?: Partial<Record<ToolProfile, string>>
  /** Profiles that do NOT get the skills index (persona threads have no tools and no skills). */
  skillsExcludedProfiles?: readonly ToolProfile[]
}

export interface KernelConfig {
  maxStepsPerTurn: number
  compactionThreshold: number
  turnTimeoutMs: number
  defaultPermissionMode: PermissionMode
  /** Global 总是允许 grants (every desktop-chat thread); read per call. */
  allowAlways: string[]
  /** Stream watchdog / retry policy for model requests (model/resilientSample.ts); defaults when absent. */
  stream?: ResilientSampleOptions
}

export interface KernelOptions {
  services: KernelServices
  config: () => KernelConfig
  systemPrompt: SystemPromptConfig
  logger?: Logger
  /** 总是允许 answered with scope 'global': persist the key so `config().allowAlways` includes it. */
  onGlobalGrant?: (key: string) => void
}

export interface KernelEvents {
  on(listener: (e: Event) => void): () => void
}

export interface Kernel {
  /** The only entry point; unknown threadId → throws. */
  submit(op: Op): Promise<void>
  events: KernelEvents
  listThreads(opts?: {
    query?: string
    limit?: number
    offset?: number
    channel?: ChannelKind
    nonEmpty?: boolean
    /** Only archived threads (the 已归档 list); otherwise archived threads are left out. */
    archivedOnly?: boolean
  }): Promise<ThreadRecord[]>
  /** Full-text hits in the conversations a person has (child / internal threads left out), newest first. */
  searchThreads(
    query: string,
    opts?: { limit?: number; channel?: ChannelKind; marks?: readonly [string, string] },
  ): Promise<RolloutSearchHit[]>
  /**
   * `running`: a turn of this thread is in progress right now (a reloaded renderer resumes its working state);
   * `pendingAsks`: its approvals / questions still waiting for an answer, as their request events.
   */
  getThread(threadId: ThreadId): Promise<
    | {
        record: ThreadRecord
        items: HistoryItem[]
        running: boolean
        pendingAsks?: PendingAskEvent[]
      }
    | undefined
  >
  ensureThread(origin: ThreadOrigin, settings?: Partial<ThreadSettings>, threadId?: ThreadId): Promise<ThreadId>
  runOnce(
    threadId: ThreadId,
    input: UserInput,
    opts?: { signal?: AbortSignal },
  ): Promise<{ text: string; artifacts: ToolArtifact[] }>
  /** Post an assistant note (a reminder) into a thread as its own turn, without a model call (notes.ts). */
  postNote(threadId: ThreadId, text: string): Promise<void>
  updateMeta(threadId: ThreadId, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<void>
  /**
   * A new thread (same origin and settings, the given title) whose history is `sourceId`'s up to and including the
   * turn holding `throughItemId`. Rejects with `code` 'fork_target_missing' / 'fork_turn_running' (see fork.ts).
   */
  forkThread(sourceId: ThreadId, opts: { throughItemId: ItemId; title: string }): Promise<ThreadId>
  removeThread(threadId: ThreadId): Promise<void>
  shutdown(): Promise<void>
}

/** Options for one-shot child runs (delegate_analysis). Internal to the kernel package. */
export interface ChildRunOptions {
  parentThreadId: ThreadId
  origin: ThreadOrigin
  input: UserInput
  depth: number
  maxSteps: number
  signal?: AbortSignal
  label: string
  /**
   * 'subagent' (default) = read-only child. A workflow write step passes the parent's own profile: the child then has
   * the parent's tools, permission mode and allow-list, and its asks are answered in the parent conversation.
   */
  profile?: ToolProfile
  /** The parent's turn (the calling tool's turnId): the child's approvals and write rows show up in it. */
  parentTurnId?: TurnId
  /** The parent's tool call that runs the child: the parent's transcript shows the child's work under that row. */
  parentCallId?: CallId
  /** The workflow step the child runs (shown with its label). */
  step?: string
  /** Called while one of the child's approvals waits for the user; the returned function ends the wait. */
  onApprovalWait?: () => () => void
  /** Receives the child's trace once it ends (done or failed), for the calling tool's result. */
  onTrace?: (trace: SubagentTrace) => void
}

/** The concrete kernel exposes child runs for the delegate tool. */
export interface KernelInternal extends Kernel {
  runChild(opts: ChildRunOptions): Promise<{ text: string; artifacts: ToolArtifact[] }>
}
