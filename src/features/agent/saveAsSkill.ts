/**
 * 存为技能… (thread menus in the panel and the Agent window): opens the thread and puts a request into its composer
 * asking the Agent to distil this conversation's workflow into a reusable skill, saved with `skill_manage`. Nothing
 * is sent — the user reads, edits and sends it (and approves the write) like any other message.
 */
import type { ThreadId } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { t } from '@/i18n'
import type { useAgentStore } from './agentStore'

export function prefillSaveAsSkill(store: typeof useAgentStore.getState, threadId: ThreadId): void {
  store().openThread(threadId, { activate: true })
  const prompt = t('agent.thread.saveAsSkillPrompt')
  const current = store().drafts[threadId]?.text.trim() ?? ''
  // An unsent draft is kept: the request goes after it instead of replacing it.
  if (!current.includes(prompt)) store().setDraft(threadId, { text: current ? `${current}\n\n${prompt}` : prompt })
  if (store().collapsed) runCommand('agent.toggleCollapsed')
  store().requestFocus()
}
