/**
 * 每日待办 feature — registers the dashboard Tab (kind 'todo', single instance objectId 'todo'), the
 * group-chat object list of rail fn 'todo' (toggles pick the chats to scan) and its workspace empty
 * state. `tab.openTodo {sourceId?}` is wired by app/tabCommands like every other tab.open* command.
 */
import { t } from '@/i18n'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { TodoEmpty } from './TodoEmpty'
import { SOURCE_SEGMENTS, TodoSourceList } from './TodoSourceList'
import { TodoTab } from './TodoTab'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'todo', icon: 'list-todo', component: TodoTab, title: () => t('todo.tab.title') })
  registerObjectList({
    fn: 'todo',
    get title() {
      return t('todo.list.title')
    },
    get searchPlaceholder() {
      return t('todo.list.search')
    },
    component: TodoSourceList,
    segments: SOURCE_SEGMENTS.map((s) => ({
      id: s.id,
      get label() {
        return t(s.labelKey)
      },
    })),
    workspaceEmpty: TodoEmpty,
  })
}
