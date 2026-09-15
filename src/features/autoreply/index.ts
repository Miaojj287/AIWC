/**
 * Auto-reply feature — registers the 自动回复 object list (rail fn 'autoreply'), the rule editor Tab
 * (kind 'autoreply', objectId = sessionId) and the `tab.openAutoReply` command.
 */
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { RULE_SEGMENTS, RuleList } from './RuleList'
import { RuleEditorTab } from './RuleEditorTab'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  // tab.title stores the chat's own name; the localized 自动回复 · prefix is added at render.
  registerTab({
    kind: 'autoreply',
    icon: 'reply',
    component: RuleEditorTab,
    title: (tab) => t('autoreply.tab.title', { name: tab.title }),
  })
  registerObjectList({
    fn: 'autoreply',
    get title() {
      return t('autoreply.list.title')
    },
    component: RuleList,
    segments: RULE_SEGMENTS.map((s) => ({
      id: s.id,
      get label() {
        return t(s.labelKey)
      },
    })),
  })
  onCommand('tab.openAutoReply', ({ sessionId, title }) => openAutoReply(sessionId, title))
}

/** Open (or focus) the rule editor for a session. */
export function openAutoReply(sessionId: string, title: string): string {
  return useTabsStore.getState().open({ kind: 'autoreply', objectId: sessionId, title })
}

export * from './ruleModel'
export * from './recordModel'
