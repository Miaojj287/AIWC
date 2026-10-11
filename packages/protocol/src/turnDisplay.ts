/**
 * How a turn's work is shown, as data: a tool call's one-line summary (a stable code the renderer words in the UI
 * language), the automatic checks a turn ran (a citation audit), the arguments of a tool call the model is still
 * writing, and what a sub-agent did. Kept apart from ops.ts so the core wire contract stays small; ops.ts unions
 * the events into `Event`, history.ts records the checks.
 */
import { z } from 'zod'
import type { CallId, ItemId, ThreadId, TurnId } from './ids'
import type { HistoryItem } from './history'

/**
 * A tool call's summary as data. The renderer words it (agent.toolSummary.<code>) from these params plus the call's
 * own input, so the row follows the UI language live and after a reload alike. A tool declares one only when the
 * sentence needs something its input does not carry (a task's name, an MCP server's label); everything else is
 * worded from the tool name and input.
 */
export interface ToolSummary {
  /** Stable code: a built-in tool's name, or a family such as `mcp`. */
  code: string
  params?: Record<string, string | number | boolean>
}

/** The checks a host can run on a finished answer. */
export const TURN_CHECK_KINDS = ['citations'] as const

/** Issues kept per check (the rest are counted only). */
export const TURN_CHECK_MAX_ISSUES = 8
/** Longest quote / excerpt kept in an issue. */
export const TURN_CHECK_TEXT_CHARS = 160

const checkText = z.string().max(TURN_CHECK_TEXT_CHARS * 2)

export const TurnCheckIssueSchema = z.discriminatedUnion('code', [
  /** The cited message does not exist in the local records. */
  z.object({ code: z.literal('missing_message'), link: checkText }),
  /** The quoted words are not in the cited message (nor next to it); `excerpt` is what the message says. */
  z.object({ code: z.literal('quote_mismatch'), link: checkText, quote: checkText, excerpt: checkText }),
])
export type TurnCheckIssue = z.infer<typeof TurnCheckIssueSchema>

/**
 * One automatic check of an answer (系统自动检查). `action` is what the turn did about it: nothing to do, the answer
 * was sent back to be rewritten, or the issues stand because no rewrite was left. `failed` may exceed
 * `issues.length` (only the first are kept).
 */
export const TurnCheckSchema = z.object({
  kind: z.enum(TURN_CHECK_KINDS),
  checked: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  issues: z.array(TurnCheckIssueSchema).max(TURN_CHECK_MAX_ISSUES),
  action: z.enum(['none', 'rewrite', 'kept']),
})
export type TurnCheck = z.infer<typeof TurnCheckSchema>

/** A finished child run (delegate_analysis / workflow_run step), kept with the parent's tool result for history. */
export interface SubagentTrace {
  childId: string
  label: string
  status: 'done' | 'failed'
  /** The workflow step it ran, when it ran one. */
  step?: string
  startedAt: number
  durationMs: number
  /** The child's own work: replies, tool calls and results (outputs shortened). */
  items: HistoryItem[]
  /** Items left out to keep the trace bounded. */
  omitted?: number
}

/** Items kept in a trace (the newest), and the longest tool output kept per item. */
export const SUBAGENT_TRACE_MAX_ITEMS = 80
export const SUBAGENT_TRACE_OUTPUT_CHARS = 2000

export type TurnDisplayEvent =
  | {
      /**
       * The model is still writing a tool call's arguments: `delta` continues the raw JSON text (throttled by the
       * kernel). The call's `tool.call` event replaces whatever was parsed from it.
       */
      type: 'tool.input'
      threadId: ThreadId
      turnId: TurnId
      callId: CallId
      toolName: string
      delta: string
    }
  | { type: 'turn.check'; threadId: ThreadId; turnId: TurnId; itemId: ItemId; check: TurnCheck }
