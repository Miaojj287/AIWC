/**
 * Kernel tooling barrel — implements the ports in ../ports.ts (registry, router, approvals, hooks,
 * rollout, skills) and ships the built-in skill / plan tools.
 */
export { createToolRegistry, SEND_TO_ORIGIN_TOOLS, DELEGATION_TOOLS } from './registry'
export {
  createToolRouterFactory,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  USER_DENIED_MESSAGE,
  POLICY_DENIED_MESSAGE,
  type ToolRouterBuildOptions,
  type ToolRouterFactoryWithOptions,
  type ToolRouterFactoryDeps,
  type ToolRouterPolicy,
} from './router'
export {
  createApprovalGate,
  decideApproval,
  channelVerdict,
  APPROVAL_MATRIX,
  BOT_CHANNELS,
  CRON_WRITE_PREFIXES,
  type MatrixCell,
} from './approval'
export { createHookRunner, type HookLogger } from './hooks'
export { createRolloutStore, replay, type RolloutStoreOptions, type RolloutStoreExt } from './rollout'
export { openRolloutIndex, type RolloutIndex } from './rolloutIndex'
export {
  createSkillIndex,
  parseSkillFile,
  truncateDescription,
  SKILL_DESCRIPTION_MAX,
  SKILL_BODY_MAX_CHARS,
  SKILLS_INDEX_TOKEN_CAP,
  type SkillDir,
  type SkillIndexExt,
  type SkillFrontmatter,
  type ParsedSkillFile,
} from './skillIndex'
export { skillTools, stampCreatedBy, SKILL_NAME_RE } from './skillTools'
export { planTools, UpdatePlanInput, PlanStepSchema, type UpdatePlanInputT, type PlanToolServices } from './planTools'
// createFragment / truncateToTokens live in @aiwc/protocol (kernel/src/index.ts re-exports the runtime
// createFragment explicitly); nothing here re-exports them.
export { zodToJsonSchema, compactInput, toJsonValue, truncateText, TRUNCATION_MARKER, type TruncatedText } from './schema'
