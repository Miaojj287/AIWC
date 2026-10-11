/**
 * IPC channels for skills and memory review. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type {
  MemoryProposal,
  MemoryProposalAcceptRequest,
  MemoryProposalAcceptResult,
  MemoryProposalDismissRequest,
} from '../memoryReview'
import type { SkillDetail, SkillEntry, SkillIdRequest, SkillSetEnabledRequest } from '../skills'

/** Invoke channels (skills and memory review). */
export interface SkillsInvokeMap {
  // ---- memory review (设置 › 记忆 › 待确认) ----
  /** Pending memory proposals, newest first. */
  'memoryReview:list': { req: void; res: MemoryProposal[] }
  /** Write one proposal (optionally edited) through the memory store; removed from the list only when written. */
  'memoryReview:accept': { req: MemoryProposalAcceptRequest; res: MemoryProposalAcceptResult }
  /** Drop proposals without writing anything. */
  'memoryReview:dismiss': { req: MemoryProposalDismissRequest; res: void }

  // ---- skills (设置 › 技能) ----
  /** Every skill folder after a rescan — disabled and broken ones included, with their diagnostics. */
  'skills:list': { req: void; res: SkillEntry[] }
  /** One skill with its markdown body (bounded) for the viewer. */
  'skills:get': { req: SkillIdRequest; res: SkillDetail }
  /** Switch a skill on or off by name; off = not offered to the model or in the `/` menu. */
  'skills:setEnabled': { req: SkillSetEnabledRequest; res: void }
  /** Delete a user- or Agent-created skill folder (built-in skills are refused). */
  'skills:delete': { req: SkillIdRequest; res: void }
}

/** Push events (skills and memory review). */
export interface SkillsEventMap {
  // ---- memory review ----
  /** The whole pending list after any change (added, accepted, dismissed). */
  'memoryReview:changed': { items: MemoryProposal[] }
  // ---- skills ----
  /** The skill list after any change (created by the Agent, enabled / disabled, deleted). */
  'skills:changed': { skills: SkillEntry[] }
}

export const SKILLS_INVOKE_CHANNELS = [
  // memory review
  'memoryReview:list',
  'memoryReview:accept',
  'memoryReview:dismiss',
  // skills
  'skills:list',
  'skills:get',
  'skills:setEnabled',
  'skills:delete',
] as const satisfies readonly (keyof SkillsInvokeMap)[]
export const SKILLS_EVENT_CHANNELS = [
  // memory review
  'memoryReview:changed',
  // skills
  'skills:changed',
] as const satisfies readonly (keyof SkillsEventMap)[]
