/**
 * AI 克隆 feature — registers the contact list (rail fn 'clone'), the clone Tab (kind 'clone',
 * objectId = contactId) and the `tab.openClone` command.
 */
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { CloneTab } from './CloneTab'
import { CLONE_SEGMENTS, ContactList } from './ContactList'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  // tab.title stores the contact's own name; the localized AI 克隆 · / 克隆中 · prefix is added at render
  // (CloneTab mirrors the building state into tab.state.building).
  registerTab({
    kind: 'clone',
    icon: 'bot',
    component: CloneTab,
    title: (tab) => t(tab.state?.building ? 'clone.tab.titleBuilding' : 'clone.tab.title', { name: tab.title }),
  })
  // Getters: registered once at startup, read at render so the header follows the UI language.
  registerObjectList({
    fn: 'clone',
    get title() {
      return t('clone.list.title')
    },
    component: ContactList,
    segments: CLONE_SEGMENTS.map((s) => ({
      id: s.id,
      get label() {
        return t(s.labelKey)
      },
    })),
  })
  onCommand('tab.openClone', ({ contactId, title }) => openClone(contactId, title))
}

/** Open (or focus) the clone tab for a contact; `title` is the contact name. */
export function openClone(contactId: string, title: string): string {
  return useTabsStore.getState().open({ kind: 'clone', objectId: contactId, title })
}

export * from './cloneView'
export * from './personaChat'
export * from './profileModel'
