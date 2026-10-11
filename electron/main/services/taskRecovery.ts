/**
 * 定时任务 recovery policy, pure: why a slot was missed, whether a missed slot is run late (catch-up), how a failed
 * run is classified from the kernel's structured error (code / HTTP status — never message text), and when a
 * rate-limited or network-failed run is tried again.
 */
import { TASK_CATCH_UP_WINDOW_MS, type ScheduledTask, type TaskRunReason } from '@aiwc/protocol'
import type { MissedSlots } from './taskTiming'

/** A slot fired this late is still "on time"; later than this it counts as missed. */
export const LATE_GRACE_MS = 2 * 60_000
/** Reruns after a rate limit or network failure, on top of the kernel's own in-turn retries. */
export const MAX_TASK_RETRIES = 2
const RETRY_BASE_MS = 60_000
const RETRY_MAX_MS = 30 * 60_000

/** The structured part of the kernel's last 'error' event for a run. */
export interface RunErrorInfo {
  code: string
  message: string
  status?: number
  retryAfterMs?: number
}

/**
 * A missed slot after the last heartbeat happened while the app was not running; one before it (or during a
 * detected wake-from-sleep gap) happened while the machine was asleep.
 */
export function missedReason(
  latest: number,
  aliveAt: number | undefined,
  sleptFrom: number | undefined,
): Extract<TaskRunReason, 'app_not_running' | 'machine_asleep'> {
  if (sleptFrom !== undefined && latest > sleptFrom) return 'machine_asleep'
  if (aliveAt === undefined || latest > aliveAt) return 'app_not_running'
  return 'machine_asleep'
}

/** Run the latest missed slot late, or only record it. */
export function catchUpDecision(
  task: Pick<ScheduledTask, 'catchUp'>,
  missed: MissedSlots,
  now: number,
): 'run' | 'record' {
  if (task.catchUp === 'skip' || missed.latest === undefined) return 'record'
  return now - missed.latest <= TASK_CATCH_UP_WINDOW_MS ? 'run' : 'record'
}

/** The stable reason code of a failed run, from the kernel's error event. */
export function reasonForRunError(error: RunErrorInfo | undefined): TaskRunReason | undefined {
  switch (error?.code) {
    case 'auth':
    case 'unsupported_tools':
      return 'model_unavailable'
    case 'invalid_request':
      return error.status === 404 ? 'model_unavailable' : undefined
    case 'rate_limit':
      return 'rate_limited'
    case 'network':
    case 'stream_stalled':
      return 'network'
    case 'empty_response':
      return 'empty_result'
    case 'output_truncated':
      return 'truncated'
    case 'content_filter':
      return 'content_filter'
    default:
      return undefined
  }
}

/**
 * A failed run is tried again only when the failure is transient AND nothing beyond reads happened: rerunning a
 * run that already wrote or sent would repeat it.
 */
export function shouldRetryRun(reason: TaskRunReason | undefined, sideEffects: number, attempt: number): boolean {
  return (reason === 'rate_limited' || reason === 'network') && sideEffects === 0 && attempt < MAX_TASK_RETRIES
}

/** 1 min, 4 min, … capped at 30 min; never sooner than the provider's Retry-After. */
export function taskRetryDelayMs(attempt: number, retryAfterMs?: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 4 ** Math.max(0, attempt - 1))
  return Math.max(exp, retryAfterMs ?? 0)
}
