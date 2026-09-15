/**
 * ObjectList body for the 定时任务 rail function: one row per task (name · schedule + status · toggle),
 * a 新建 row on top, the same menu on `···` and right-click. Figma 184:354 puts the tasks in a card
 * grid; in AIWC's four-column layout they are the object list and the editor opens as a tab.
 */
import { CalendarClock, Ellipsis, MessageSquare, Pause, Pencil, Play, Plus, Square, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ScheduledTask } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT, type MessageKey } from '@/i18n'
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ICON_STROKE,
  IconButton,
  ListItem,
  ScrollArea,
  SkeletonListRows,
  Spinner,
  Toggle,
  cn,
  toast,
  type MenuSpec,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { useListCounts } from '@/shell/objectList/listHeaderContext'
import { useShellStore } from '@/shell/shellStore'
import { filterTasks, describeSchedule, segmentCounts, taskStatusLine, type TaskSegment } from './scheduleModel'
import { useTaskStore, useTasks } from './taskStore'

export const TASK_SEGMENTS: ReadonlyArray<{ id: TaskSegment; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'on', labelKey: 'tasks.list.segments.on' },
  { id: 'paused', labelKey: 'tasks.list.segments.paused' },
]

export const openTask = (task: Pick<ScheduledTask, 'id' | 'name'>): void =>
  runCommand('tab.openTask', { id: task.id, title: task.name })

export const openNewTask = (templateId?: string): void => runCommand('tab.openTask', { id: 'new', templateId })

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function TaskList({ query, activeObjectId }: ObjectListProps) {
  const t = useT()
  const { tasks, loaded, loading, error } = useTasks()
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: TaskSegment = TASK_SEGMENTS.some((s) => s.id === segmentId) ? (segmentId as TaskSegment) : 'all'
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const counts = useMemo(() => segmentCounts(tasks), [tasks])
  useListCounts(counts)
  const rows = useMemo(() => filterTasks(tasks, query, segment), [tasks, query, segment])

  if (loading && !loaded) return <SkeletonListRows rows={5} className="px-2.5 py-2" />
  if (error && !loaded)
    return (
      <EmptyState
        compact
        variant="error"
        title={t('tasks.list.loadFailed')}
        description={error.message}
        action={{ label: t('common.retry'), onClick: () => void useTaskStore.getState().load() }}
      />
    )

  return (
    <>
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-1 px-2 py-1.5" role="list" aria-label={t('tasks.list.ariaLabel')}>
          <Button variant="outline" icon={Plus} className="w-full justify-start" onClick={() => openNewTask()}>
            {t('tasks.list.new')}
          </Button>
          {rows.length === 0 ? (
            tasks.length === 0 ? (
              <EmptyState
                compact
                variant="empty"
                title={t('tasks.list.emptyTitle')}
                description={t('tasks.list.emptyDescription')}
              />
            ) : (
              <EmptyState
                compact
                variant="no-results"
                title={query.trim() ? t('tasks.list.noMatch', { query }) : t('tasks.list.noneInSegment')}
                description={segment !== 'all' ? t('tasks.list.switchToAllHint') : undefined}
                action={
                  segment !== 'all' ? { label: t('tasks.list.viewAll'), onClick: () => setSegment(null) } : undefined
                }
              />
            )
          ) : (
            rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={activeObjectId === task.id}
                onDelete={() => setDeleteTarget(task)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <DangerDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('tasks.editor.deleteTitle', { name: deleteTarget?.name ?? '' })}
        description={t('tasks.editor.deleteDescription')}
        onConfirm={async () => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) await removeTask(target, t)
        }}
      />
    </>
  )
}

export async function removeTask(task: ScheduledTask, t: ReturnType<typeof useT>): Promise<boolean> {
  try {
    await invoke('task:delete', { id: task.id })
    toast.success(t('tasks.editor.toasts.deleted', { name: task.name }))
    return true
  } catch (e) {
    toast.error(t('tasks.editor.toasts.deleteFailed'), { detail: errorText(e) })
    return false
  }
}

export async function toggleTask(task: ScheduledTask, enabled: boolean, t: ReturnType<typeof useT>): Promise<void> {
  try {
    await invoke('task:setEnabled', { id: task.id, enabled })
    toast.success(
      enabled
        ? t('tasks.editor.toasts.enabled', { name: task.name })
        : t('tasks.editor.toasts.paused', { name: task.name }),
    )
  } catch (e) {
    toast.error(t('tasks.editor.toasts.toggleFailed'), { detail: errorText(e) })
  }
}

export async function runTaskNow(task: ScheduledTask, t: ReturnType<typeof useT>): Promise<void> {
  try {
    await invoke('task:runNow', { id: task.id })
    toast.info(t('tasks.editor.toasts.started', { name: task.name }))
  } catch (e) {
    toast.error(t('tasks.editor.toasts.runFailed'), { detail: errorText(e) })
  }
}

export async function stopTask(task: ScheduledTask, t: ReturnType<typeof useT>): Promise<void> {
  if (await invoke('task:cancel', { id: task.id })) toast.info(t('tasks.editor.toasts.stopped', { name: task.name }))
}

/** Shared by the list row and the editor's `···`: regular → cross-feature → danger (CLAUDE.md §4.2). */
export function taskMenu(
  task: ScheduledTask,
  t: ReturnType<typeof useT>,
  actions: { edit?: () => void; delete: () => void; latestThreadId?: string },
): MenuSpec {
  const items: MenuSpec = []
  if (actions.edit) items.push({ id: 'edit', label: t('tasks.list.menu.edit'), icon: Pencil, onSelect: actions.edit })
  items.push(
    task.running
      ? { id: 'stop', label: t('tasks.list.menu.stop'), icon: Square, onSelect: () => void stopTask(task, t) }
      : { id: 'run', label: t('tasks.list.menu.runNow'), icon: Play, onSelect: () => void runTaskNow(task, t) },
    task.enabled
      ? { id: 'pause', label: t('tasks.list.menu.pause'), icon: Pause, onSelect: () => void toggleTask(task, false, t) }
      : {
          id: 'resume',
          label: t('tasks.list.menu.resume'),
          icon: Play,
          onSelect: () => void toggleTask(task, true, t),
        },
  )
  if (actions.latestThreadId) {
    const threadId = actions.latestThreadId
    items.push(
      { type: 'separator' },
      {
        id: 'thread',
        label: t('tasks.list.menu.openThread'),
        icon: MessageSquare,
        onSelect: () => runCommand('agent.openThread', { threadId }),
      },
    )
  }
  items.push(
    { type: 'separator' },
    { id: 'delete', label: t('tasks.list.menu.delete'), icon: Trash, danger: true, onSelect: actions.delete },
  )
  return items
}

function TaskRow({ task, selected, onDelete }: { task: ScheduledTask; selected: boolean; onDelete: () => void }) {
  const t = useT()
  const status = taskStatusLine(task, t)
  const latest = useTaskStore((s) => s.runs[task.id]?.find((r) => r.threadId)?.threadId)
  const menu = taskMenu(task, t, { edit: () => openTask(task), delete: onDelete, latestThreadId: latest })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          role="listitem"
          leading={<TaskTile running={Boolean(task.running)} paused={!task.enabled} />}
          title={task.name}
          subtitle={
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                status.kind === 'running' && 'text-accent',
                status.kind === 'failed' && 'text-danger',
              )}
            >
              {/* The schedule is short and identifies the row; the status is what gives when space runs out. */}
              <span className="shrink-0 truncate max-w-[60%]">{describeSchedule(task.schedule, t)}</span>
              <span aria-hidden className="shrink-0 text-fg-3/60">
                ·
              </span>
              <span className="min-w-0 truncate" title={status.text}>
                {status.text}
              </span>
            </span>
          }
          selected={selected}
          onSelect={() => openTask(task)}
          trailing={
            <Toggle
              label={t('tasks.list.toggleLabel', { name: task.name })}
              checked={task.enabled}
              onCheckedChange={(enabled) => void toggleTask(task, enabled, t)}
              onClick={(e) => e.stopPropagation()}
            />
          }
          hoverActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('tasks.list.moreActions')} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 36×36 r8 tile in the avatar slot: accent while active, weak while paused, a spinner while a run is going. */
export function TaskTile({ running, paused, size = 36 }: { running: boolean; paused: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-item',
        paused ? 'bg-line-8 text-fg-3' : 'bg-accent-15 text-accent',
      )}
      style={{ width: size, height: size }}
    >
      {running ? <Spinner size={16} /> : <CalendarClock size={size >= 36 ? 18 : 14} strokeWidth={ICON_STROKE} />}
    </span>
  )
}
