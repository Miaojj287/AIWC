/**
 * Editor state for one 定时任务 tab: the saved task (live from the store), the draft, dirty / errors,
 * and the actions (save, delete, enable, run, raise-mode-and-rerun). objectId 'new' edits a task that
 * does not exist yet, optionally pre-filled from a template named in the tab state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PermissionMode, ScheduledTask } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import type { TabDescriptor } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import {
  draftFromTask,
  emptyDraft,
  sameDraft,
  validateDraft,
  type TaskDraft,
  type TaskDraftErrors,
} from './scheduleModel'
import { useTaskRuns, useTaskStore, useTasks } from './taskStore'

export const NEW_TASK_ID = 'new'

export interface TaskEditor {
  isNew: boolean
  loading: boolean
  error?: Error
  /** The saved task; undefined for a new one (or one that no longer exists). */
  task?: ScheduledTask
  /** The task was deleted while its tab was open (from the list, or another window). */
  missing: boolean
  runs: ReturnType<typeof useTaskRuns>
  draft?: TaskDraft
  dirty: boolean
  errors: TaskDraftErrors
  valid: boolean
  saving: boolean
  patch(patch: Partial<TaskDraft>): void
  reset(): void
  reload(): void
  save(): Promise<ScheduledTask | undefined>
  remove(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  /** Save with a higher permission mode (what a denied run needed) and run again. */
  raiseModeAndRerun(mode: PermissionMode): Promise<void>
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function useTaskEditor(tab: TabDescriptor): TaskEditor {
  const t = useT()
  const isNew = tab.objectId === NEW_TASK_ID
  const id = isNew ? undefined : tab.objectId
  const templateId = typeof tab.state?.templateId === 'string' ? tab.state.templateId : undefined

  // Existing task: the store keeps it live (toggles from the list, run status); the first read fills the store.
  const { loaded, loading: listLoading, error: listError } = useTasks()
  const task = useTaskStore((s) => (id ? s.tasks.find((item) => item.id === id) : undefined))
  const runs = useTaskRuns(id)
  const templates = useInvoke('task:templates', undefined, [], { enabled: isNew })
  const template = templateId ? templates.data?.find((tpl) => tpl.id === templateId) : undefined

  const saved = useMemo<TaskDraft | undefined>(() => {
    if (isNew) return templateId && !templates.data ? undefined : emptyDraft(template)
    return task ? draftFromTask(task) : undefined
  }, [isNew, templateId, templates.data, template, task])

  const [draft, setDraft] = useState<TaskDraft | undefined>(undefined)
  const base = useRef<TaskDraft | undefined>(undefined)
  // Follow the saved task while the draft has no local edits; keep local edits otherwise.
  useEffect(() => {
    if (!saved) return
    const clean = !draft || !base.current || sameDraft(draft, base.current)
    if (clean) setDraft(saved)
    base.current = saved
    // `draft` is deliberately not a dependency: this only reacts to the saved side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])

  const dirty = Boolean(draft && saved && !sameDraft(draft, saved)) || Boolean(draft && isNew && !saved)
  const errors = useMemo(() => (draft ? validateDraft(draft, t) : {}), [draft, t])
  const valid = Object.keys(errors).length === 0
  const [saving, setSaving] = useState(false)

  const patch = useCallback((p: Partial<TaskDraft>) => setDraft((d) => (d ? { ...d, ...p } : d)), [])
  const reset = useCallback(() => setDraft(saved), [saved])
  const reload = useCallback(() => void useTaskStore.getState().load(), [])

  const persist = useCallback(
    async (next: TaskDraft): Promise<ScheduledTask> => {
      const result = await invoke('task:save', { ...(id ? { id } : {}), ...next })
      base.current = draftFromTask(result)
      setDraft(base.current)
      return result
    },
    [id],
  )

  const save = useCallback(async (): Promise<ScheduledTask | undefined> => {
    if (!draft || !valid) return undefined
    setSaving(true)
    try {
      const result = await persist(draft)
      if (isNew) {
        // The 'new' tab becomes the task's own tab so a second 新建 starts clean.
        useTabsStore.getState().close(tab.id)
        runCommand('tab.openTask', { id: result.id, title: result.name })
        toast.success(t('tasks.editor.toasts.created', { name: result.name }))
      } else toast.success(t('tasks.editor.toasts.saved', { name: result.name }))
      return result
    } catch (e) {
      toast.error(t('tasks.editor.toasts.saveFailed'), { detail: errorText(e) })
      return undefined
    } finally {
      setSaving(false)
    }
  }, [draft, valid, persist, isNew, tab.id, t])

  const remove = useCallback(async () => {
    if (!task) return
    try {
      await invoke('task:delete', { id: task.id })
      toast.success(t('tasks.editor.toasts.deleted', { name: task.name }))
      useTabsStore.getState().close(tab.id)
    } catch (e) {
      toast.error(t('tasks.editor.toasts.deleteFailed'), { detail: errorText(e) })
    }
  }, [task, tab.id, t])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      patch({ enabled })
      if (!task) return
      try {
        await invoke('task:setEnabled', { id: task.id, enabled })
        base.current = base.current ? { ...base.current, enabled } : base.current
      } catch (e) {
        patch({ enabled: !enabled })
        toast.error(t('tasks.editor.toasts.toggleFailed'), { detail: errorText(e) })
      }
    },
    [patch, task, t],
  )

  const raiseModeAndRerun = useCallback(
    async (mode: PermissionMode) => {
      if (!draft || !task) return
      setSaving(true)
      try {
        const result = await persist({ ...draft, permissionMode: mode })
        await invoke('task:runNow', { id: task.id })
        toast.info(t('tasks.editor.toasts.started', { name: result.name }))
      } catch (e) {
        toast.error(t('tasks.editor.toasts.runFailed'), { detail: errorText(e) })
      } finally {
        setSaving(false)
      }
    },
    [draft, task, persist, t],
  )

  const loading = isNew ? Boolean(templateId) && templates.loading : !loaded && listLoading
  const error = isNew ? templates.error : listError

  return {
    isNew,
    loading,
    error,
    task,
    missing: !isNew && loaded && !task,
    runs,
    draft,
    dirty,
    errors,
    valid,
    saving,
    patch,
    reset,
    reload,
    save,
    remove,
    setEnabled,
    raiseModeAndRerun,
  }
}
