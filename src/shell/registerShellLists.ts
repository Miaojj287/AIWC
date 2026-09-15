/**
 * Object lists the shell itself provides. The chat function's session list lives here because it is
 * the default view of the workbench; 自动回复 / AI 克隆 register theirs from their feature packages.
 */
import { t } from '@/i18n'
import { registerObjectList } from './objectListRegistry'
import { SessionList } from './objectList/SessionList'
import { SESSION_SEGMENTS } from './objectList/sessionListModel'

let registered = false

export function registerShellLists(): void {
  if (registered) return
  registered = true
  // Getters: registered once at startup, read at render so the header follows the UI language.
  registerObjectList({
    fn: 'chat',
    get title() {
      return t('shell.sessions.title')
    },
    component: SessionList,
    segments: SESSION_SEGMENTS.map((s) => ({
      id: s.id,
      get label() {
        return t(s.labelKey)
      },
    })),
  })
}
