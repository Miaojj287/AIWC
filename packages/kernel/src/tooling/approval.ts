/**
 * Approval gate: the pure mode × risk × channel × allow-list decision (ARCHITECTURE §6) and the
 * pending-ask registry the Op handler resolves.
 */
import {
  normalizePermissionMode,
  type ApprovalDecision,
  type ApprovalId,
  type ChannelKind,
  type PermissionMode,
  type ThreadId,
  type ToolRisk,
} from '@aiwc/protocol'
import type { ApprovalGate, ApprovalRequest, ApprovalVerdict } from '../ports'
import { SEND_TO_ORIGIN_TOOLS } from './registry'

/** 'allow_list' = approved when the tool is in the thread's allow-always list, otherwise ask. */
export type MatrixCell = ApprovalVerdict | 'allow_list'

/**
 * Reads never ask in any mode; writes ask in Ask mode (allow-listable) and run freely in Bypass;
 * outward-facing sends (WeChat messages, pushes to office platforms) run without asking only in
 * Autopilot. Destructive operations ask in every mode (CLAUDE.md §4.4).
 *
 * | mode \ risk | read     | write      | send     | destructive |
 * | ask         | approved | allow_list | ask      | ask         |
 * | bypass      | approved | approved   | ask      | ask         |
 * | autopilot   | approved | approved   | approved | ask         |
 */
export const APPROVAL_MATRIX: Readonly<Record<PermissionMode, Readonly<Record<ToolRisk, MatrixCell>>>> = {
  ask: { read: 'approved', write: 'allow_list', send: 'ask', destructive: 'ask' },
  bypass: { read: 'approved', write: 'approved', send: 'ask', destructive: 'ask' },
  autopilot: { read: 'approved', write: 'approved', send: 'approved', destructive: 'ask' },
}

/** Channels that have no human at the keyboard and are bound to a single WeChat chat. */
export const BOT_CHANNELS: readonly ChannelKind[] = ['wechat-ilink', 'wechat-ui', 'observed']

/** Cron threads may always write memory; prefixes are the memory package's naming convention. */
export const CRON_WRITE_PREFIXES: readonly string[] = ['remember', 'memory_']

/**
 * Is this call covered by the thread's allow-list? A grant matches the call's own key (a command
 * prefix such as `shell:git commit`) or the whole tool (`shell`). Destructive calls never match:
 * nothing destructive can be pre-approved (CLAUDE.md §4.4).
 */
export function isAllowListed(
  allowAlways: readonly string[],
  toolName: string,
  allowKey: string | undefined,
  risk: ToolRisk,
): boolean {
  if (risk === 'destructive') return false
  return allowAlways.includes(toolName) || (allowKey !== undefined && allowAlways.includes(allowKey))
}

/**
 * Channel overrides applied before the matrix.
 * Returns undefined when the channel has no opinion and the matrix decides.
 *
 * A scheduled (cron) thread has nobody to ask, so its mode decides outright: whatever the matrix would
 * approve runs; whatever it would ask about is denied instead (reads and memory writes always run) —
 * the denial is reported back to the model and listed on the run so the user can raise the mode.
 * A thread allow-list still counts, as on the desktop.
 */
export function channelVerdict(
  channel: ChannelKind,
  toolName: string,
  risk: ToolRisk,
  allowAlways: readonly string[] = [],
  allowKey?: string,
  mode: PermissionMode = 'ask',
): ApprovalVerdict | undefined {
  if (BOT_CHANNELS.includes(channel)) {
    if (risk === 'write' || risk === 'destructive') return 'denied'
    if (risk === 'send') return SEND_TO_ORIGIN_TOOLS.includes(toolName) ? 'approved' : 'denied'
    return undefined
  }
  if (channel === 'cron') {
    if (risk === 'read') return 'approved'
    if (risk === 'write' && CRON_WRITE_PREFIXES.some((p) => toolName.startsWith(p))) return 'approved'
    if (isAllowListed(allowAlways, toolName, allowKey, risk)) return 'approved'
    return APPROVAL_MATRIX[normalizePermissionMode(mode)][risk] === 'approved' ? 'approved' : 'denied'
  }
  return undefined
}

export function decideApproval(input: {
  toolName: string
  allowKey?: string
  risk: ToolRisk
  mode: PermissionMode
  channel: ChannelKind
  allowAlways: readonly string[]
}): ApprovalVerdict {
  const fromChannel = channelVerdict(
    input.channel,
    input.toolName,
    input.risk,
    input.allowAlways,
    input.allowKey,
    input.mode,
  )
  if (fromChannel) return fromChannel
  // A thread persisted by an older build may carry a mode that no longer exists; ask rather than throw.
  const cell = (APPROVAL_MATRIX[input.mode] ?? APPROVAL_MATRIX[normalizePermissionMode(input.mode)])[input.risk]
  if (cell === 'allow_list')
    return isAllowListed(input.allowAlways, input.toolName, input.allowKey, input.risk) ? 'approved' : 'ask'
  return cell
}

interface Pending {
  threadId: ThreadId
  settle: (decision: ApprovalDecision) => void
}

export function createApprovalGate(): ApprovalGate {
  const pending = new Map<ApprovalId, Pending>()

  return {
    decide: decideApproval,

    ask(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
      if (signal.aborted) return Promise.resolve('deny')
      return new Promise<ApprovalDecision>((resolve) => {
        const onAbort = (): void => settle('deny')
        const settle = (decision: ApprovalDecision): void => {
          if (!pending.has(req.approvalId)) return
          pending.delete(req.approvalId)
          signal.removeEventListener('abort', onAbort)
          resolve(decision)
        }
        pending.set(req.approvalId, { threadId: req.threadId, settle })
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },

    resolve(approvalId, decision, threadId) {
      const entry = pending.get(approvalId)
      if (!entry) return false
      // A thread may only answer its own asks; a mismatched threadId leaves the request pending.
      if (threadId !== undefined && entry.threadId !== threadId) return false
      entry.settle(decision)
      return true
    },

    cancelAll(threadId) {
      for (const [, entry] of [...pending]) {
        if (entry.threadId === threadId) entry.settle('deny')
      }
    },
  }
}
