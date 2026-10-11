/**
 * The 定时任务 clock: one timer that wakes at the soonest due slot (and at least every MAX_SLEEP_MS), so a slot that
 * passed while the machine slept is noticed as such — a wake much later than planned means the process was
 * suspended. Every wake hands the scheduler `now` and, after such a gap, when the sleep began. It also writes the
 * heartbeat (the last time the app was known to be running) that tells "app was closed" from "machine was asleep"
 * at the next launch.
 */
import { existsSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'

/** Longest the clock sleeps between wakes. */
export const MAX_SLEEP_MS = 30_000
/** A wake later than planned by more than this means the machine was asleep (or the process suspended). */
const SLEEP_GAP_MS = 60_000
/** How often the heartbeat is written while the app runs. */
export const HEARTBEAT_MS = 60_000

export type SetTimer = (fn: () => void, ms: number) => () => void

/** setTimeout that does not keep the process alive; returns its cancel function. */
export const defaultSetTimer: SetTimer = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  ;(timer as { unref?: () => void }).unref?.()
  return () => clearTimeout(timer)
}

export interface TaskTickerDeps {
  now(): number
  /** Soonest due time over all tasks; undefined when nothing is scheduled. */
  nextDue(): number | undefined
  /** `sleptFrom` = when the gap began, set only when this wake follows a sleep. */
  onWake(now: number, sleptFrom: number | undefined): void
  heartbeatPath: string
  setTimer?: SetTimer
  logger?: (level: 'debug' | 'warn', msg: string, meta?: unknown) => void
}

export interface TaskTicker {
  /** Last heartbeat written by a previous session (read once at creation). */
  readonly previousAliveAt: number | undefined
  start(): void
  /** Re-plan the next wake (a task was saved, toggled or removed). */
  replan(): void
  stop(): void
}

export function readHeartbeat(path: string): number | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = (JSON.parse(readFileSync(path, 'utf8')) as { aliveAt?: unknown }).aliveAt
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  } catch {
    // a torn heartbeat only loses the app-closed / asleep distinction for one launch
    return undefined
  }
}

export function createTaskTicker(deps: TaskTickerDeps): TaskTicker {
  const setTimer = deps.setTimer ?? defaultSetTimer
  const previousAliveAt = readHeartbeat(deps.heartbeatPath)
  let cancel: (() => void) | undefined
  let plannedAt: number | undefined
  /** When the current wait was planned: after a sleep gap, slots since then were slept through. */
  let plannedFrom: number | undefined
  let lastBeat = 0
  let running = false

  const beat = (now: number): void => {
    if (now - lastBeat < HEARTBEAT_MS) return
    lastBeat = now
    const tmp = `${deps.heartbeatPath}.${process.pid}.${now}.tmp`
    void writeFile(tmp, JSON.stringify({ aliveAt: now }), 'utf8')
      .then(() => rename(tmp, deps.heartbeatPath))
      .catch((e) => deps.logger?.('warn', 'tasks: heartbeat write failed', { error: String(e) }))
  }

  const plan = (): void => {
    cancel?.()
    if (!running) return
    const now = deps.now()
    const due = deps.nextDue()
    const wait = Math.max(0, Math.min(MAX_SLEEP_MS, due === undefined ? MAX_SLEEP_MS : due - now))
    plannedFrom = now
    plannedAt = now + wait
    cancel = setTimer(wake, wait)
  }

  function wake(): void {
    const now = deps.now()
    const sleptFrom = plannedAt !== undefined && now - plannedAt > SLEEP_GAP_MS ? plannedFrom : undefined
    if (sleptFrom !== undefined) deps.logger?.('debug', 'tasks: woke after a gap', { sleptFrom, now })
    try {
      deps.onWake(now, sleptFrom)
    } finally {
      beat(now)
      plan()
    }
  }

  return {
    previousAliveAt,
    start() {
      if (running) return
      running = true
      plannedAt = undefined
      wake()
    },
    replan: plan,
    stop() {
      running = false
      cancel?.()
      cancel = undefined
    },
  }
}
