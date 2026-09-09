/**
 * AI 克隆 feature — registers the contact list (rail fn 'clone'), the clone Tab (kind 'clone',
 * objectId = contactId) and the `tab.openClone` command.
 */
import { onCommand } from '@/app/commands'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { CLONE_TAB_PREFIX, CloneTab } from './CloneTab'
import { CLONE_SEGMENTS, ContactList } from './ContactList'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'clone', icon: 'bot', component: CloneTab })
  registerObjectList({ fn: 'clone', title: 'AI 克隆', component: ContactList, segments: CLONE_SEGMENTS.map((s) => ({ id: s.id, label: s.label })) })
  onCommand('tab.openClone', ({ contactId, title }) => openClone(contactId, title))
}

/** Open (or focus) the clone tab for a contact. */
export function openClone(contactId: string, title: string): string {
  return useTabsStore.getState().open({ kind: 'clone', objectId: contactId, title: `${CLONE_TAB_PREFIX}${title}` })
}

export { CloneTab, CLONE_TAB_PREFIX, CLONE_BUILDING_PREFIX } from './CloneTab'
export { ContactList, CLONE_SEGMENTS } from './ContactList'
export { PersonaChat, type PersonaChatProps } from './views/PersonaChat'
export * from './cloneView'
export * from './personaChat'
export * from './profileModel'
