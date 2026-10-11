/**
 * Memory review (待确认): proposed memory entries that are not written until the user accepts them.
 *
 * Two producers: the idle-thread extraction (设置 › 记忆 › 自动写入记忆) and the Agent's `remember` tool while
 * 「写入前需要确认」 is on. Accepting writes through the memory store (lock, drift check, character budget and
 * the entry-count cap all apply); dismissing drops the proposal. Proposals never reach the model.
 */
import { z } from 'zod'
import type { Millis } from './ids'

/** The memory files a proposal may target: the two the Agent writes (SOUL / AGENTS stay user-authored). */
export const MEMORY_PROPOSAL_FILES = ['MEMORY', 'USER'] as const
export const MemoryProposalFileSchema = z.enum(MEMORY_PROPOSAL_FILES)
export type MemoryProposalFile = z.infer<typeof MemoryProposalFileSchema>

/** Who proposed it: 'extraction' = distilled from an idle conversation; 'agent' = a `remember` call held for review. */
export const MemoryProposalOriginSchema = z.enum(['extraction', 'agent'])
export type MemoryProposalOrigin = z.infer<typeof MemoryProposalOriginSchema>

/** Longest proposal text (matches the `remember` tool's input cap). */
export const MEMORY_PROPOSAL_MAX_CHARS = 500
/** Pending proposals kept at most; further proposals are refused until the user reviews the list. */
export const MEMORY_PROPOSALS_MAX = 50

export const MemoryProposalSchema = z.object({
  id: z.string().regex(/^mp_[A-Za-z0-9_-]{6,32}$/),
  file: MemoryProposalFileSchema,
  text: z.string().min(1).max(MEMORY_PROPOSAL_MAX_CHARS),
  origin: MemoryProposalOriginSchema,
  createdAt: z.number().int().nonnegative(),
  /** The Agent conversation it came from (provenance shown in the list). */
  threadId: z.string().max(64).optional(),
  threadTitle: z.string().max(200).optional(),
})
export interface MemoryProposal extends z.infer<typeof MemoryProposalSchema> {
  createdAt: Millis
}

/**
 * Why accepting did not write. Stable codes (the renderer maps them to copy):
 * not_found = already handled elsewhere; duplicate = the file already holds it; over_budget = the file's
 * character budget is full; over_count = the file reached 设置 › 记忆 › 记忆条数上限; blocked = the file was
 * edited outside the app and must be re-saved in settings first.
 */
export type MemoryProposalAcceptFailure = 'not_found' | 'duplicate' | 'over_budget' | 'over_count' | 'blocked'

export type MemoryProposalAcceptResult = { ok: true } | { ok: false; reason: MemoryProposalAcceptFailure }

/** IPC request of memoryReview:accept: the user may edit the text or move it to the other file first. */
export const MemoryProposalAcceptRequestSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MEMORY_PROPOSAL_MAX_CHARS).optional(),
  file: MemoryProposalFileSchema.optional(),
})
export type MemoryProposalAcceptRequest = z.infer<typeof MemoryProposalAcceptRequestSchema>

export const MemoryProposalDismissRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MEMORY_PROPOSALS_MAX),
})
export type MemoryProposalDismissRequest = z.infer<typeof MemoryProposalDismissRequestSchema>
