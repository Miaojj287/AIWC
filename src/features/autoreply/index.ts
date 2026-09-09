/**
 * Auto-reply feature — registers the 自动回复 object list (rail fn 'autoreply'), the rule editor Tab
 * (kind 'autoreply', objectId = sessionId) and the `tab.openAutoReply` command.
 */
import { onCommand } from '@/app/commands'
import { registerObjectList } from '@/shell/objectListRegistry'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { RULE_SEGMENTS, RuleList } from './RuleList'
import { AUTOREPLY_TAB_PREFIX, RuleEditorTab } from './RuleEditorTab'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'autoreply', icon: 'reply', component: RuleEditorTab })
  registerObjectList({ fn: 'autoreply', title: '自动回复', component: RuleList, segments: RULE_SEGMENTS.map((s) => ({ id: s.id, label: s.label })) })
  onCommand('tab.openAutoReply', ({ sessionId, title }) => openAutoReply(sessionId, title))
}

/** Open (or focus) the rule editor for a session. */
export function openAutoReply(sessionId: string, title: string): string {
  return useTabsStore.getState().open({ kind: 'autoreply', objectId: sessionId, title: `${AUTOREPLY_TAB_PREFIX}${title}` })
}

export { RuleList, RULE_SEGMENTS } from './RuleList'
export { RuleEditorTab } from './RuleEditorTab'
export { useRuleEditor, type RuleEditor } from './useRuleEditor'
export * from './ruleModel'
export * from './recordModel'
