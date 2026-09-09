/**
 * World state: the handful of environment facts the model must know but that rarely change. Snapshotted
 * before every step; only changed sections become a fragment (ARCHITECTURE §5.5).
 */
import type { ContextFragment, JsonValue, PermissionMode, ToolProfile } from '@aiwc/protocol'
import { worldStateDiffFragment } from './fragments/worldStateDiff'

export interface WorldStateSnapshot {
  permissions: PermissionMode
  model: string
  /** sorted tool names */
  tools: string[]
  /**
   * Digest (fnv1a64) of the <user_instructions> fragment text the model has seen, '' when there are no rules.
   * A digest rather than the text: the rules themselves live in history as their own fragment, and persisting
   * up to 2k tokens of AGENTS.md in every world_state rollout line was the double-injection bug.
   */
  userInstructions: string
  profile: ToolProfile
}

export type WorldStateSection = keyof WorldStateSnapshot
const SECTIONS: readonly WorldStateSection[] = ['permissions', 'model', 'tools', 'userInstructions', 'profile']

export function snapshotWorldState(input: {
  permissionMode: PermissionMode
  modelId: string
  toolNames: readonly string[]
  /** digest of the recorded user_instructions fragment (see WorldStateSnapshot) */
  userInstructions?: string
  profile: ToolProfile
}): WorldStateSnapshot {
  return {
    permissions: input.permissionMode,
    model: input.modelId,
    tools: [...input.toolNames].sort(),
    userInstructions: input.userInstructions ?? '',
    profile: input.profile,
  }
}

export function diffWorldState(prev: WorldStateSnapshot | undefined, next: WorldStateSnapshot): WorldStateSection[] {
  if (!prev) return [...SECTIONS]
  return SECTIONS.filter((k) => {
    const a = prev[k]
    const b = next[k]
    return Array.isArray(a) && Array.isArray(b) ? a.join(' ') !== b.join(' ') : a !== b
  })
}

export function worldStateToJson(s: WorldStateSnapshot): Record<string, JsonValue> {
  return { permissions: s.permissions, model: s.model, tools: s.tools, userInstructions: s.userInstructions, profile: s.profile }
}

export function worldStateFromJson(v: Record<string, JsonValue> | undefined): WorldStateSnapshot | undefined {
  if (!v) return undefined
  const tools = Array.isArray(v.tools) ? v.tools.filter((t): t is string => typeof t === 'string') : []
  if (typeof v.permissions !== 'string' || typeof v.profile !== 'string') return undefined
  return {
    permissions: v.permissions as PermissionMode,
    model: typeof v.model === 'string' ? v.model : '',
    tools,
    userInstructions: typeof v.userInstructions === 'string' ? v.userInstructions : '',
    profile: v.profile as ToolProfile,
  }
}

/** Holds the baseline the model has already seen. reset() forces a full re-injection on the next step. */
export class WorldStateTracker {
  private baseline: WorldStateSnapshot | undefined

  constructor(initial?: WorldStateSnapshot) {
    this.baseline = initial
  }

  current(): WorldStateSnapshot | undefined {
    return this.baseline
  }

  reset(): void {
    this.baseline = undefined
  }

  /** Returns a fragment describing the changed sections (or undefined) and advances the baseline. */
  diff(next: WorldStateSnapshot): { fragment: ContextFragment; changed: WorldStateSection[] } | undefined {
    const changed = diffWorldState(this.baseline, next)
    this.baseline = next
    if (changed.length === 0) return undefined
    return { fragment: worldStateDiffFragment(next, changed), changed }
  }
}
