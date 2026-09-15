/**
 * 定时任务 Tab (kind 'task', objectId = task id or 'new'): header · 任务（名称、Agent 指令 + 权限 / 模型
 * 工具栏，同 Agent 面板的输入框）· 执行时间 · 最近运行 · sticky save bar. Figma 184:354's 新建定时任务
 * dialog, laid out as a workspace tab like the 自动回复 rule editor (CLAUDE.md §1: every page is a tab).
 */
import { Ellipsis, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DangerDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  InlineHint,
  ModelSelect,
  PermissionSelect,
  ScrollArea,
  SettingRow,
  Textarea,
  Toggle,
} from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatTime } from '@/platform/format'
import { useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { RunsCard } from './editor/RunsCard'
import { ScheduleCard } from './editor/ScheduleCard'
import { describeSchedule } from './scheduleModel'
import { runTaskNow, stopTask, taskMenu, TaskTile } from './TaskList'
import { useTaskEditor } from './useTaskEditor'

export function TaskTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const editor = useTaskEditor(tab)
  const models = useInvoke('agent:listModels', undefined, [])
  // No model on the task = the app default; the toolbar shows that model's own name, never "默认".
  const defaultModel = useConfig((c) => c.ai.defaultModel)
  const [dialog, setDialog] = useState<'delete' | 'discard' | null>(null)
  const { task, draft, dirty } = editor

  useEffect(() => {
    if (tab.dirty !== dirty) update({ dirty })
  }, [dirty, tab.dirty, update])
  useEffect(() => {
    if (task && tab.title !== task.name) update({ title: task.name })
  }, [task, tab.title, update])
  // Deleted from the list while open: nothing left to edit, so the tab goes (no dirty guard — the object is gone).
  useEffect(() => {
    if (editor.missing) useTabsStore.getState().close(tab.id)
  }, [editor.missing, tab.id])

  if (editor.loading || (!draft && !editor.error))
    return <EmptyState variant="loading" title={t('tasks.editor.loading')} className="h-full" />
  if (!draft)
    return (
      <EmptyState
        variant="error"
        title={t('tasks.editor.loadFailed')}
        description={editor.error?.message}
        action={{ label: t('common.retry'), onClick: editor.reload }}
        className="h-full"
      />
    )

  const running = Boolean(task?.running)
  const badge = editor.isNew
    ? { tone: 'neutral' as const, text: t('tasks.editor.badgeNew') }
    : running
      ? { tone: 'accent' as const, text: t('tasks.editor.badgeRunning') }
      : draft.enabled
        ? { tone: 'ok' as const, text: t('tasks.editor.badgeOn') }
        : { tone: 'neutral' as const, text: t('tasks.editor.badgePaused') }
  const meta = [
    describeSchedule(draft.schedule, t),
    editor.isNew
      ? t('tasks.editor.metaNew')
      : task?.nextRunAt
        ? t('tasks.editor.metaNext', { time: formatTime(task.nextRunAt) })
        : task?.lastRunAt
          ? t('tasks.editor.metaLast', { time: formatTime(task.lastRunAt) })
          : t('tasks.editor.metaNoRun'),
  ].join(' · ')
  const title = draft.name.trim() || (editor.isNew ? t('tasks.tab.new') : (task?.name ?? ''))
  const saveReason = !editor.valid
    ? Object.values(editor.errors)[0]
    : !dirty
      ? t('tasks.editor.nothingToSave')
      : undefined
  const runReason = editor.isNew || !task || dirty ? t('tasks.editor.saveFirst') : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
        <TaskTile running={running} paused={!draft.enabled} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-bubble font-medium leading-5 text-fg">{title}</span>
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </div>
          <span className="truncate text-caption text-fg-3">{meta}</span>
        </div>
        <label className="flex items-center gap-2 text-caption text-fg-2">
          {t('common.enable')}
          <Toggle
            label={t('common.enable')}
            checked={draft.enabled}
            onCheckedChange={(v) => void editor.setEnabled(v)}
          />
        </label>
        {task ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={Ellipsis} label={t('tasks.list.moreActions')} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItems
                items={taskMenu(task, t, {
                  delete: () => setDialog('delete'),
                  latestThreadId: editor.runs?.find((r) => r.threadId)?.threadId,
                })}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex w-full max-w-[880px] flex-col gap-4 px-5 pb-6 pt-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-caption text-fg-3">{t('tasks.editor.sectionTask')}</h2>
            <Card variant="rows">
              <SettingRow
                title={t('tasks.editor.name')}
                stacked
                footer={
                  editor.errors.name && draft.name !== '' ? (
                    <InlineHint kind="error">{editor.errors.name}</InlineHint>
                  ) : null
                }
              >
                <Input
                  aria-label={t('tasks.editor.name')}
                  placeholder={t('tasks.editor.namePlaceholder')}
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => editor.patch({ name: e.target.value })}
                  autoFocus={editor.isNew}
                />
              </SettingRow>
              <SettingRow title={t('tasks.editor.prompt')} description={t('tasks.editor.promptDescription')} stacked>
                {/* Same composer card as the Agent panel: the text, then the mode / model toolbar underneath. */}
                <div className="flex flex-col gap-2 rounded-item border border-line-8 bg-content p-2">
                  <Textarea
                    autosize
                    minRows={6}
                    maxRows={18}
                    aria-label={t('tasks.editor.prompt')}
                    placeholder={t('tasks.editor.promptPlaceholder')}
                    value={draft.prompt}
                    onChange={(e) => editor.patch({ prompt: e.target.value })}
                    className="border-transparent bg-transparent px-1"
                  />
                  <div className="flex items-center gap-1" role="group" aria-label={t('tasks.editor.toolbar')}>
                    <PermissionSelect
                      value={draft.permissionMode}
                      onChange={(permissionMode) => editor.patch({ permissionMode })}
                      onOpenRules={() => runCommand('tab.openSettings', { page: 'ai', highlight: 'permissions' })}
                    />
                    <span className="flex-1" />
                    <ModelSelect
                      models={models.data ?? []}
                      value={draft.model ?? defaultModel}
                      onChange={(model) => editor.patch({ model })}
                      onManage={() => runCommand('tab.openSettings', { page: 'ai' })}
                    />
                  </div>
                </div>
              </SettingRow>
            </Card>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-caption text-fg-3">{t('tasks.editor.sectionSchedule')}</h2>
            <ScheduleCard
              schedule={draft.schedule}
              errors={editor.errors}
              onChange={(schedule) => editor.patch({ schedule })}
            />
          </section>

          {task ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-caption text-fg-3">{t('tasks.editor.sectionRuns')}</h2>
              <RunsCard
                task={task}
                runs={editor.runs}
                busy={editor.saving}
                onRaiseMode={(mode) => void editor.raiseModeAndRerun(mode)}
              />
            </section>
          ) : null}
        </div>
      </ScrollArea>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line-6 px-5">
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3">
          {task?.updatedAt
            ? t('tasks.editor.lastSaved', { time: formatTime(task.updatedAt) })
            : t('tasks.editor.notSaved')}
          {dirty ? ` · ${t('tasks.editor.unsaved')}` : ''}
        </span>
        {task ? (
          running ? (
            <Button variant="ghost" icon={Square} onClick={() => void stopTask(task, t)}>
              {t('tasks.editor.stop')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={Play}
              disabled={Boolean(runReason)}
              title={runReason}
              onClick={() => void runTaskNow(task, t)}
            >
              {t('tasks.editor.runNow')}
            </Button>
          )
        ) : null}
        <Button variant="ghost" disabled={!dirty} onClick={() => setDialog('discard')}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || !editor.valid}
          loading={editor.saving}
          title={saveReason}
          onClick={() => void editor.save()}
        >
          {editor.isNew ? t('tasks.editor.create') : t('tasks.editor.save')}
        </Button>
      </footer>

      <DangerDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('tasks.editor.deleteTitle', { name: task?.name ?? '' })}
        description={t('tasks.editor.deleteDescription')}
        onConfirm={async () => {
          setDialog(null)
          await editor.remove()
        }}
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('tasks.editor.discardTitle')}
        description={t('tasks.editor.discardDescription')}
        confirmLabel={t('tasks.editor.discard')}
        cancelLabel={t('tasks.editor.keepEditing')}
        tone="warn"
        onConfirm={() => {
          editor.reset()
          setDialog(null)
        }}
      />
    </div>
  )
}
