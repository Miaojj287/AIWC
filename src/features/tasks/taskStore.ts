/**
 * 定时任务 as the renderer sees them (zustand): the task list from task:list, runs per task from
 * task:runs, both kept live by the 'task:changed' / 'task:run' pushes. One subscription per window,
 * started by whichever surface (list, tab, empty state) mounts first.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ScheduledTask, TaskRun } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'
import { invoke } from '@/platform/hooks'

interface TasksState {
  tasks: ScheduledTask[]
  loaded: boolean
  loading: boolean
  error?: Error
  /** Newest first, per task; absent until that task's runs were requested. */
  runs: Record<string, TaskRun[]>
  load(): Promise<void>
  loadRuns(taskId: string): Promise<void>
  applyRun(run: TaskRun): void
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

export const useTaskStore = create<TasksState>((set, get) => ({
  tasks: [],
  loaded: false,
  loading: false,
  runs: {},

  async load() {
    set({ loading: true })
    try {
      const tasks = await invoke('task:list', undefined)
      set({ tasks, loaded: true, loading: false, error: undefined })
    } catch (e) {
      set({ loading: false, error: toError(e) })
    }
  },

  async loadRuns(taskId) {
    try {
      const runs = await invoke('task:runs', { id: taskId, limit: 20 })
      set((s) => ({ runs: { ...s.runs, [taskId]: runs } }))
    } catch {
      /* the tab shows the list it has; the next push refreshes it */
    }
  },

  applyRun(run) {
    set((s) => {
      const list = s.runs[run.taskId]
      const runs = list
        ? { ...s.runs, [run.taskId]: [run, ...list.filter((r) => r.id !== run.id)].slice(0, 20) }
        : s.runs
      const tasks = s.tasks.map((task) =>
        task.id === run.taskId
          ? {
              ...task,
              running: run.status === 'running' ? true : undefined,
              ...(run.status !== 'running' && run.status !== 'skipped'
                ? { lastRunAt: run.startedAt, lastRunStatus: run.status }
                : {}),
            }
          : task,
      )
      return { runs, tasks }
    })
    if (!get().runs[run.taskId]) void get().loadRuns(run.taskId)
  },
}))

let subscription: Promise<void> | undefined

export function ensureTaskSubscription(): Promise<void> {
  subscription ??= getBridge()
    .then((bridge) => {
      bridge.on('task:changed', () => void useTaskStore.getState().load())
      bridge.on('task:run', (run) => useTaskStore.getState().applyRun(run))
      return useTaskStore.getState().load()
    })
    .catch(() => {
      subscription = undefined
    })
  return subscription
}

export function useTasks(): Pick<TasksState, 'tasks' | 'loaded' | 'loading' | 'error'> {
  useEffect(() => {
    void ensureTaskSubscription()
  }, [])
  const tasks = useTaskStore((s) => s.tasks)
  const loaded = useTaskStore((s) => s.loaded)
  const loading = useTaskStore((s) => s.loading)
  const error = useTaskStore((s) => s.error)
  return { tasks, loaded, loading, error }
}

export function useTaskRuns(taskId: string | undefined): TaskRun[] | undefined {
  useEffect(() => {
    void ensureTaskSubscription()
    if (taskId) void useTaskStore.getState().loadRuns(taskId)
  }, [taskId])
  return useTaskStore((s) => (taskId ? s.runs[taskId] : undefined))
}

export function __resetTaskStoreForTests(): void {
  subscription = undefined
  useTaskStore.setState({ tasks: [], loaded: false, loading: false, error: undefined, runs: {} })
}
