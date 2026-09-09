// Kernel runtime barrel — see docs/PACKAGE-API.md (@aiwc/kernel › runtime).
export { createKernel, profileForChannel } from './kernel'
export type { Kernel, KernelOptions, KernelConfig, KernelEvents, KernelInternal, ChildRunOptions, Logger, LogLevel } from './types'
export { Thread, type ThreadDeps, type ThreadInit } from './thread'
export { startTurn, inputText, type TurnDeps, type TurnHandle, type TurnResult, type AbortReason } from './turn'
export { runStep, freezeStepContext, type StepContext, type StepDeps, type StepOutcome } from './step'
export { executeToolCalls, outcomeToResultItem, interruptedOutcome, INTERRUPT_GRACE_MS } from './toolExec'
export { LoopGuard, callFingerprint, canonicalJson } from './loopGuard'
export { PromptBuilder, type PromptBuilderDeps, type BuildPromptInput, type BuiltPrompt, type StablePrompt } from './prompt'
export {
  compactContext,
  shouldCompact,
  selectCompactionSplit,
  renderTranscript,
  summarizeWithModel,
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_TAIL_RATIO,
  type CompactInput,
  type CompactionDeps,
} from './compaction'
export { ContextManager, dropOrphans, estimateItemTokens, renderToolOutput, DEFAULT_TOOL_OUTPUT_CHARS, type ContextManagerOptions, type RecordOptions, type UsageInput } from './context/manager'
export * from './context/fragments'
export {
  WorldStateTracker,
  snapshotWorldState,
  diffWorldState,
  worldStateToJson,
  worldStateFromJson,
  type WorldStateSnapshot,
  type WorldStateSection,
} from './context/worldState'
export * from './model'
export { createDelegateTool, DELEGATE_TOOL_NAME, DELEGATE_MAX_TASKS, DELEGATE_CHILD_STEP_CAP, DelegateInputSchema, type DelegateInput } from './delegate'
export { createEmitter, type Emitter } from './emitter'
export { createRwLock, type RwLock } from './util/rwlock'
