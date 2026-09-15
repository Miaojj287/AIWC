/**
 * 定时任务 feature — registers the tasks object list (rail fn 'tasks'), its workspace empty state
 * with templates, and the task editor Tab (kind 'task', objectId = task id or 'new').
 * `tab.openTask` itself is wired by app/tabCommands like every other tab.open* command.
 */
import { t } from '@/i18n'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { TASK_SEGMENTS, TaskList } from './TaskList'
import { TasksEmpty } from './TasksEmpty'
import { TaskTab } from './TaskTab'
import { NEW_TASK_ID } from './useTaskEditor'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({
    kind: 'task',
    icon: 'calendar-clock',
    component: TaskTab,
    title: (tab) =>
      tab.objectId === NEW_TASK_ID || !tab.title ? t('tasks.tab.new') : t('tasks.tab.title', { name: tab.title }),
  })
  registerObjectList({
    fn: 'tasks',
    get title() {
      return t('tasks.list.title')
    },
    component: TaskList,
    segments: TASK_SEGMENTS.map((s) => ({
      id: s.id,
      get label() {
        return t(s.labelKey)
      },
    })),
    workspaceEmpty: TasksEmpty,
  })
}

export * from './scheduleModel'
