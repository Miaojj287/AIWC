/**
 * Kernel tooling barrel — implements the ports in ../ports.ts (registry, router, approvals, hooks,
 * rollout, skills) and ships the built-in skill / plan tools.
 */
export { createToolRegistry } from './registry'
export { createToolRouterFactory } from './router'
export { createApprovalGate } from './approval'
export { createHookRunner } from './hooks'
export { createRolloutStore } from './rollout'

export { createSkillIndex } from './skillIndex'
export { skillTools } from './skillTools'
export { planTools } from './planTools'
// createFragment / truncateToTokens live in @aiwc/protocol (kernel/src/index.ts re-exports the runtime
// createFragment explicitly); nothing here re-exports them.
