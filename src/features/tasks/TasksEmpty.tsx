/**
 * Workspace empty state for the 定时任务 function (Figma 184:354 「开始创建第一个定时任务」 + 定时任务模板):
 * the generic empty copy with a primary 新建, then the templates as cards that open a pre-filled editor.
 */
import { CalendarClock, Plus } from 'lucide-react'
import { useT } from '@/i18n'
import { Badge, EmptyState, ScrollArea, cn } from '@/kit'
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
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10">
        <EmptyState
          icon={CalendarClock}
          title={hasTasks ? t('workspace.empty.tasks.title') : t('tasks.empty.title')}
          description={hasTasks ? t('workspace.empty.tasks.description') : t('tasks.empty.description')}
          action={{ label: t('tasks.empty.new'), icon: Plus, onClick: () => openNewTask() }}
          data-testid="workspace-empty"
        />
        {templates.data?.length ? (
          <section className="flex flex-col gap-2" aria-label={t('tasks.empty.templates')}>
            <h2 className="text-caption text-fg-3">{t('tasks.empty.templates')}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.data.map((tpl) => {
                const copy = templateCopy(tpl.id, t)
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => openNewTask(tpl.id)}
                    className={cn(
                      'flex min-w-0 flex-col items-start gap-1.5 rounded-card border border-line-6 bg-panel p-4 text-left',
                      'transition-colors duration-(--dur-fast) hover:bg-raised',
                      'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                    )}
                  >
                    <span className="w-full min-w-0 truncate text-body font-medium text-fg">{copy.name}</span>
                    <span className="line-clamp-2 text-caption text-fg-3">{copy.description}</span>
                    <Badge tone="neutral" className="mt-0.5">
                      {describeSchedule(tpl.schedule, t)}
                    </Badge>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  )
}
