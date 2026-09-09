/**
 * Kernel-internal ports. The runtime (thread / turn / step / context) depends on these interfaces,
 * and the tooling half (registry / approval / hooks / rollout / skills) implements them. Both halves
 * are developed against this file — change it deliberately.
 */
import type {
  ApprovalDecision,
  ApprovalId,
  CallId,
  ChannelKind,
  ContextFragment,
  FragmentProvider,
  Event,
  HistoryItem,
  ItemId,
  JsonValue,
  ModelClient,
  PermissionMode,
  StepId,
  ThreadId,
  ThreadOrigin,
  ThreadSettings,
  ToolArtifact,
  ToolDefinition,
  ToolProfile,
  ToolResult,
  ToolRisk,
  ToolSpecForModel,
  TurnId,
} from '@aiwc/protocol'

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export interface ToolRegistry {
  register(tool: ToolDefinition<any, any>): void
  unregister(name: string): void
  get(name: string): ToolDefinition<any, any> | undefined
  list(): ToolDefinition<any, any>[]
  /** Tools visible for a profile, excluding names in `deny`. */
  forProfile(profile: ToolProfile, opts?: { deny?: readonly string[]; depth?: number }): ToolDefinition<any, any>[]
}

export interface ToolCallRequest {
  callId: CallId
  toolName: string
  /** parsed input (already JSON); validation happens in dispatch */
  input: unknown
}

export interface ToolDispatchContext {
  threadId: ThreadId
  turnId: TurnId
  stepId: StepId
  channel: ChannelKind
  profile: ToolProfile
  origin?: ThreadOrigin
  depth: number
  signal: AbortSignal
  emit: (event: Event) => void
}

export interface ToolDispatchOutcome {
  callId: CallId
  toolName: string
  result: ToolResult
  isError: boolean
  status: 'done' | 'error' | 'denied' | 'timeout'
  durationMs: number
  artifacts?: ToolArtifact[]
}

/**
 * Frozen per-step view of the tools: built once per sampling request so specs and dispatch agree.
 */
export interface ToolRouter {
  readonly specs: ToolSpecForModel[]
  has(name: string): boolean
  risk(name: string): ToolRisk | undefined
  parallelSafe(name: string): boolean
  summarize(name: string, input: unknown): string
  /** Full funnel: validate → approval → PreToolUse hooks → execute (timeout) → PostToolUse → truncate. */
  dispatch(call: ToolCallRequest, ctx: ToolDispatchContext): Promise<ToolDispatchOutcome>
}

export interface ToolRouterBuildOptions {
  profile: ToolProfile
  depth: number
  deny?: readonly string[]
  /** Runtime getters consulted by the approval step (default: ask mode, empty allow-list). */
  permissionMode?: () => PermissionMode
  allowAlways?: () => readonly string[]
  /** Called when the user answers "总是允许"; the runtime persists it into ThreadSettings. */
  onAllowAlways?: (toolName: string) => void
}

export interface ToolRouterFactory {
  build(opts: ToolRouterBuildOptions): ToolRouter
}

// ---------------------------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------------------------

export type ApprovalVerdict = 'approved' | 'denied' | 'ask'

export interface ApprovalRequest {
  approvalId: ApprovalId
  threadId: ThreadId
  turnId: TurnId
  callId: CallId
  toolName: string
  summary: string
  input: JsonValue
  risk: ToolRisk
  canAllowAlways: boolean
}

export interface ApprovalGate {
  /** Pure policy decision: mode × risk × allow-list × channel. Never blocks. */
  decide(input: { toolName: string; risk: ToolRisk; mode: PermissionMode; channel: ChannelKind; allowAlways: readonly string[] }): ApprovalVerdict
  /** Blocks until resolved or aborted. Emits approval.requested via the dispatcher. */
  ask(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>
  /**
   * Called from the Op handler when the UI answers. When threadId is given the gate must refuse
   * (return false) unless the pending request belongs to that thread.
   */
  resolve(approvalId: ApprovalId, decision: ApprovalDecision, threadId?: ThreadId): boolean
  /** Cancel all pending asks for a thread (interrupt / shutdown). */
  cancelAll(threadId: ThreadId): void
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'TurnAborted'

export interface HookPayload {
  threadId: ThreadId
  turnId?: TurnId
  toolName?: string
  input?: unknown
  output?: unknown
  text?: string
}

export interface HookResult {
  /** block the action (PreToolUse: tool not run; UserPromptSubmit: turn not started) */
  block?: { reason: string }
  /** extra bounded context appended as a fragment */
  additionalContext?: string
  /** rewrite tool input (PreToolUse) */
  updatedInput?: unknown
  /** replace model-visible output (PostToolUse) */
  updatedOutput?: string
}

export interface Hook {
  name: string
  events: readonly HookEventName[]
  run(event: HookEventName, payload: HookPayload): Promise<HookResult | void>
}

export interface HookRunner {
  add(hook: Hook): () => void
  run(event: HookEventName, payload: HookPayload): Promise<HookResult>
}

// ---------------------------------------------------------------------------------------------
// Rollout (persistence)
// ---------------------------------------------------------------------------------------------

export type RolloutLine =
  | { ts: number; type: 'thread_meta'; threadId: ThreadId; origin: ThreadOrigin; settings: ThreadSettings; title?: string }
  | { ts: number; type: 'settings'; settings: ThreadSettings }
  | { ts: number; type: 'item'; item: HistoryItem }
  | { ts: number; type: 'compacted'; summaryItemId: ItemId; foldedThroughId: ItemId }
  | { ts: number; type: 'turn_context'; turnId: TurnId; modelId: string; profile: ToolProfile; permissionMode: PermissionMode }
  | { ts: number; type: 'world_state'; snapshot: Record<string, JsonValue> }
  | { ts: number; type: 'event'; event: Event }

export interface ThreadRecord {
  threadId: ThreadId
  origin: ThreadOrigin
  settings: ThreadSettings
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  archived: boolean
  itemCount: number
}

export interface ResumeState {
  items: HistoryItem[]
  settings: ThreadSettings
  origin: ThreadOrigin
  title: string
  /** last compaction checkpoint, when present */
  lastCompactedThroughId?: ItemId
  worldState?: Record<string, JsonValue>
}

export interface RolloutStore {
  create(meta: { threadId: ThreadId; origin: ThreadOrigin; settings: ThreadSettings; title?: string }): Promise<void>
  append(threadId: ThreadId, lines: RolloutLine[]): Promise<void>
  /** Barrier: everything appended so far is durable. */
  flush(threadId: ThreadId): Promise<void>
  resume(threadId: ThreadId): Promise<ResumeState | undefined>
  list(opts?: { query?: string; limit?: number; channel?: ChannelKind; includeArchived?: boolean }): Promise<ThreadRecord[]>
  updateMeta(threadId: ThreadId, patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived' | 'settings'>>): Promise<void>
  remove(threadId: ThreadId): Promise<void>
  /** Zero-LLM keyword search over stored user/assistant text (FTS). */
  search(query: string, opts?: { limit?: number; threadId?: ThreadId }): Promise<Array<{ threadId: ThreadId; itemId: ItemId; snippet: string; ts: number }>>
  /**
   * Atomically replace a thread's rollout with the given live history (rollback / clear), preserving
   * thread meta (createdAt, pinned, archived, title) and writing a fresh 'compacted' checkpoint when
   * lastCompactedThroughId is present. Implementations write tmp + rename.
   */
  rewrite?(threadId: ThreadId, state: { items: HistoryItem[]; settings: ThreadSettings; lastCompactedThroughId?: ItemId; worldState?: Record<string, JsonValue> }): Promise<void>
}

// ---------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------

export interface SkillMeta {
  name: string
  description: string /** ≤ 60 chars, shown in the index fragment */
  command?: string /** slash command, e.g. '/周报' */
  source: 'builtin' | 'user' | 'agent'
  dir: string
  tags?: string[]
}

export interface SkillIndex {
  refresh(): Promise<void>
  list(): SkillMeta[]
  get(name: string): SkillMeta | undefined
  /** Full SKILL.md body (bounded). */
  read(name: string): Promise<string>
  /** Bounded fragment listing name + description of every skill. */
  indexFragment(): ContextFragment
}

// ---------------------------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------------------------

export interface ModelResolver {
  resolve(selection?: { providerId: string; modelId: string }): Promise<ModelClient>
  /** Cheap/fast model for summaries & compaction; may equal the main model. */
  resolveAuxiliary(): Promise<ModelClient>
}

// ---------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------

export interface KernelServices {
  tools: ToolRouterFactory
  approvals: ApprovalGate
  hooks: HookRunner
  rollout: RolloutStore
  skills: SkillIndex
  models: ModelResolver
  /** Fragments contributed by the host (memory snapshot, environment, relationship, observed context). */
  fragmentProviders: FragmentProvider[]
  clock?: () => number
}

/** Re-exported from @aiwc/protocol so kernel, memory and the host share one definition. */
export type { FragmentProvider, FragmentProviderContext } from '@aiwc/protocol'
