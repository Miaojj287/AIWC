/**
 * Public runtime types: the Kernel façade (docs/PACKAGE-API.md) plus small shared helpers used
 * across thread / turn / step.
 */
import type {
  ChannelKind,
  Event,
  HistoryItem,
  Op,
  PermissionMode,
  ThreadId,
  ThreadOrigin,
  ThreadSettings,
  ToolArtifact,
  ToolProfile,
  UserInput,
} from '@aiwc/protocol'
import type { KernelServices, ThreadRecord } from '../ports'

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
  allowAlways: string[]
}

export interface KernelOptions {
  services: KernelServices
  config: () => KernelConfig
  systemPrompt: SystemPromptConfig
  logger?: Logger
}

export interface KernelEvents {
  on(listener: (e: Event) => void): () => void
}

export interface Kernel {
  /** The only entry point; unknown threadId → throws. */
  submit(op: Op): Promise<void>
  events: KernelEvents
  listThreads(opts?: { query?: string; limit?: number; channel?: ChannelKind }): Promise<ThreadRecord[]>
  getThread(threadId: ThreadId): Promise<{ record: ThreadRecord; items: HistoryItem[] } | undefined>
  ensureThread(origin: ThreadOrigin, settings?: Partial<ThreadSettings>, threadId?: ThreadId): Promise<ThreadId>
  runOnce(threadId: ThreadId, input: UserInput, opts?: { signal?: AbortSignal }): Promise<{ text: string; artifacts: ToolArtifact[] }>
  updateMeta(threadId: ThreadId, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<void>
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
}

/** The concrete kernel exposes child runs for the delegate tool. */
export interface KernelInternal extends Kernel {
  runChild(opts: ChildRunOptions): Promise<{ text: string; artifacts: ToolArtifact[] }>
}
