/**
 * Workspace for the 每日待办 rail function when no tab is open: the open count and one button to the
 * dashboard (the chats to scan are switched on in the object list on the left).
 */
import { ListTodo } from 'lucide-react'
import { useMemo } from 'react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { EmptyState } from '@/kit'
import { useTodos } from './todoStore'

export function TodoEmpty() {
  const t = useT()
  const { items } = useTodos()
  const open = useMemo(() => items.filter((i) => !i.done).length, [items])
  return (
    <EmptyState
      icon={ListTodo}
      title={open > 0 ? t('todo.list.openCount', { n: open }) : t('workspace.empty.todo.title')}
      action={{ label: t('todo.empty.openDashboard'), onClick: () => runCommand('tab.openTodo', {}) }}
      className="h-full"
      data-testid="workspace-empty"
    />
  )
}
