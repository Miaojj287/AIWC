/**
 * Object lists the shell itself provides. The chat function's session list lives here because it is
 * the default view of the workbench; 自动回复 / AI 克隆 register theirs from their feature packages.
 */
import { registerObjectList } from './objectListRegistry'
import { SessionList } from './objectList/SessionList'
import { SESSION_SEGMENTS } from './objectList/sessionListModel'

let registered = false

export function registerShellLists(): void {
  if (registered) return
  registered = true
  registerObjectList({ fn: 'chat', title: '会话', component: SessionList, segments: SESSION_SEGMENTS.map((s) => ({ id: s.id, label: s.label })) })
}
