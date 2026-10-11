/**
 * What a 定时任务 run learns from its thread's kernel events: tool calls made, calls the mode denied (deduplicated by
 * allow key), calls that changed something (anything not read-only — a rerun would repeat them), and the last
 * structured error the turn reported, which decides the failure reason and whether a retry may help.
 */
import type { Event, TaskRun, ThreadId } from '@aiwc/protocol'
import type { RunErrorInfo } from './taskRecovery'

export interface RunWatch {
  /** Calls that ran with a risk above read. */
  readonly sideEffects: number
  readonly lastError: RunErrorInfo | undefined
  stop(): void
}

export function watchRun(
  events: { on(listener: (e: Event) => void): () => void },
  threadId: ThreadId,
  run: TaskRun,
): RunWatch {
  let sideEffects = 0
  let lastError: RunErrorInfo | undefined
  const off = events.on((e) => {
    if (e.threadId !== threadId) return
    if (e.type === 'error') {
      const error = e.error
      lastError = {
        code: error.code,
        message: error.message,
        ...('status' in error && error.status !== undefined ? { status: error.status } : {}),
        ...('retryAfterMs' in error && error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      }
      return
    }
    if (e.type !== 'tool.call') return
    if (e.status === 'running') run.toolCalls += 1
    else if ((e.status === 'done' || e.status === 'error' || e.status === 'timeout') && e.risk !== 'read')
      sideEffects += 1
    else if (e.status === 'denied' && !run.denied.some((d) => d.key === (e.allowKey ?? e.toolName)))
      run.denied.push({ tool: e.toolName, key: e.allowKey ?? e.toolName, risk: e.risk, summary: e.summary })
  })
  return {
    get sideEffects() {
      return sideEffects
    },
    get lastError() {
      return lastError
    },
    stop: off,
  }
}
