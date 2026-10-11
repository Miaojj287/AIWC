/**
 * 定时任务 storage: <tasksDir>/tasks.json (definitions, written tmp + rename) and <tasksDir>/runs.jsonl (history,
 * append-only, compacted when it grows). Writes are queued one behind another; a failed write is logged and never
 * stops later ones. A run still marked `running` when the files are read belongs to a session that quit or crashed:
 * it is loaded as `interrupted`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { appendFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ScheduledTaskInputSchema, type ScheduledTask, type TaskRun } from '@aiwc/protocol'

/** Runs kept in memory and in runs.jsonl after compaction. */
export const RUNS_KEEP = 500
const TASKS_FILE = 'tasks.json'
const RUNS_FILE = 'runs.jsonl'
export const HEARTBEAT_FILE = 'heartbeat.json'

export type StoredTask = Omit<ScheduledTask, 'nextRunAt' | 'running'> & {
  /** When the current schedule was set — interval tasks count from here, not from the last edit. */
  scheduleSince: number
  /** The latest slot that was handled (run, skipped or recorded as missed); missed-slot detection starts after it. */
  lastSlotAt?: number
}

interface TasksFile {
  version: 1
  tasks: StoredTask[]
}

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface TaskFiles {
  loadTasks(): StoredTask[]
  /** `interrupted`: some runs were found still running and were rewritten as interrupted. */
  loadRuns(): { runs: TaskRun[]; interrupted: number }
  persistTasks(tasks: readonly StoredTask[]): Promise<void>
  appendRun(run: TaskRun): Promise<void>
  compactRuns(runs: readonly TaskRun[]): Promise<void>
  /** Resolves once every write queued so far has landed (or failed and been logged). */
  flush(): Promise<void>
}

export function createTaskFiles(dir: string, now: () => number, log: Log): TaskFiles {
  const tasksPath = join(dir, TASKS_FILE)
  const runsPath = join(dir, RUNS_FILE)
  let writing: Promise<void> = Promise.resolve()

  /**
   * Queue one file write behind the previous one. The queued promise is the *settled* one: keeping a rejected promise
   * as the tail would make every later `.then()` skip its callback, so one failed write (a full disk, a locked file)
   * would silently stop the task file being saved for the rest of the session.
   */
  const queueWrite = (what: string, write: () => Promise<void>): Promise<void> => {
    const next = writing.then(write).catch((e) => log('error', `tasks: ${what}`, e))
    writing = next
    return next
  }

  let tmpSeq = 0
  const replaceFile = (path: string, body: string) => async (): Promise<void> => {
    // A unique temp name: a second scheduler on the same folder (tests, a fast relaunch) must not rename our half-written file.
    const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`
    await writeFile(tmp, body, 'utf8')
    try {
      await rename(tmp, path)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  }

  return {
    flush: () => writing,
    loadTasks() {
      mkdirSync(dir, { recursive: true })
      if (!existsSync(tasksPath)) return []
      const out: StoredTask[] = []
      try {
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as Partial<TasksFile>
        for (const raw of parsed.tasks ?? []) {
          const checked = ScheduledTaskInputSchema.safeParse(raw)
          if (!checked.success || !raw.id) {
            log('warn', 'tasks: dropping invalid task record', { id: raw.id })
            continue
          }
          out.push({
            ...checked.data,
            id: raw.id,
            createdAt: raw.createdAt ?? now(),
            updatedAt: raw.updatedAt ?? now(),
            scheduleSince: raw.scheduleSince ?? raw.updatedAt ?? now(),
            ...(raw.lastRunAt ? { lastRunAt: raw.lastRunAt } : {}),
            ...(raw.lastRunStatus ? { lastRunStatus: raw.lastRunStatus } : {}),
            ...(raw.lastSlotAt ? { lastSlotAt: raw.lastSlotAt } : {}),
          })
        }
      } catch (e) {
        log('error', 'tasks: tasks.json unreadable', e)
      }
      return out
    },

    loadRuns() {
      const runs: TaskRun[] = []
      let interrupted = 0
      if (!existsSync(runsPath)) return { runs, interrupted }
      try {
        for (const line of readFileSync(runsPath, 'utf8').split('\n')) {
          if (!line) continue
          try {
            const run = JSON.parse(line) as TaskRun
            if (!run.id || !run.taskId) continue
            const at = runs.findIndex((r) => r.id === run.id)
            if (at >= 0) runs.splice(at, 1)
            runs.push(run)
          } catch {
            /* a torn last line after a crash */
          }
        }
      } catch (e) {
        log('error', 'tasks: runs.jsonl unreadable', e)
      }
      const kept = runs.slice(-RUNS_KEEP).map((run) => {
        if (run.status !== 'running') return run
        interrupted++
        return { ...run, status: 'interrupted' as const, reason: 'app_quit' as const }
      })
      return { runs: kept, interrupted }
    },

    persistTasks(tasks) {
      const file: TasksFile = { version: 1, tasks: [...tasks] }
      return queueWrite('save failed', replaceFile(tasksPath, JSON.stringify(file, null, 2)))
    },

    appendRun: (run) =>
      queueWrite('run log append failed', async () => {
        await appendFile(runsPath, `${JSON.stringify(run)}\n`, 'utf8')
      }),

    compactRuns(runs) {
      const kept = runs.slice(-RUNS_KEEP)
      const body = kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : '')
      return queueWrite('run log compaction failed', replaceFile(runsPath, body))
    },
  }
}
