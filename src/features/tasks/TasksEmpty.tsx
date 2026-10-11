/**
 * Workspace empty state for the 定时任务 function (Figma 184:354 「开始创建第一个定时任务」 + 定时任务模板):
 * the generic empty copy with a primary 新建, then the templates as cards that open a pre-filled editor.
 */
import { CalendarClock, Plus } from 'lucide-react'
import { useT } from '@/i18n'
import { Badge, Button, EmptyState, ScrollArea } from '@/kit'
import { useInvoke } from '@/platform/hooks'
import { describeSchedule, templateCopy } from './scheduleModel'
import { openNewTask } from './TaskList'
import { useTasks } from './taskStore'

export function TasksEmpty() {
  const t = useT()
  const { tasks, loaded } = useTasks()
  const templates = useInvoke('task:templates', undefined, [])
  const hasTasks = loaded && tasks.length > 0
  return (
    <ScrollArea className="h-full">
      <div className="@container/templates mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10">
        <EmptyState
          icon={CalendarClock}
          title={hasTasks ? t('workspace.empty.tasks.title') : t('tasks.empty.title')}
          description={hasTasks ? undefined : t('tasks.empty.description')}
          action={{ label: t('tasks.empty.new'), icon: Plus, onClick: () => openNewTask() }}
          data-testid="workspace-empty"
        />
        {templates.loading && !templates.data ? (
          <EmptyState compact variant="loading" title={t('tasks.empty.templatesLoading')} />
        ) : templates.error ? (
          <EmptyState
            compact
            variant="error"
            title={t('tasks.empty.templatesFailed')}
            action={{ label: t('common.retry'), onClick: templates.reload }}
          />
        ) : templates.data?.length ? (
          <section className="flex flex-col gap-3" aria-label={t('tasks.empty.templates')}>
            <h2 className="text-body font-semibold text-fg">{t('tasks.empty.templates')}</h2>
            <div className="grid grid-cols-1 gap-3 @min-[520px]/templates:grid-cols-2">
              {templates.data.map((tpl) => {
                const copy = templateCopy(tpl.id, t)
                return (
                  <Button
                    key={tpl.id}
                    variant="outline"
                    onClick={() => openNewTask(tpl.id)}
                    className="h-auto min-w-0 flex-col items-start justify-start gap-2 whitespace-normal rounded-card border border-line-6 bg-panel p-5 text-left font-normal"
                  >
                    <span className="w-full min-w-0 truncate text-body font-medium text-fg">{copy.name}</span>
                    <span className="text-caption leading-5 text-fg-3">{copy.description}</span>
                    <Badge tone="neutral" className="mt-auto">
                      {describeSchedule(tpl.schedule, t)}
                    </Badge>
                  </Button>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  )
}
