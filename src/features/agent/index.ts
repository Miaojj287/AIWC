/**
 * Agent panel feature (DESIGN-SPEC §1.3, CLAUDE.md §5).
 *
 *   register()     — command handlers 'agent.quote' / 'agent.quoteText' / 'agent.newThread' / ⌘F in the conversation
 *   AgentPanel     — the right column (collapsed strip / tabs + messages + composer)
 *   MessageList    — transcript renderer, reused by the clone page
 *   Composer       — input card with @ / / popovers, reused by the clone page
 */
import { Bot, Plug, SquareTerminal, Workflow } from 'lucide-react'
import { asThreadId } from '@aiwc/protocol'
import { onCommand, runCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerTab } from '@/workspace/tabRegistry'
import { useAgentStore } from './agentStore'
import { findInConversation } from './findRequests'
import { ShellApprovalBody, ShellCard } from './messages/ShellCards'
import { DelegateCard } from './messages/SubagentRuns'
import { SubagentLogTab } from './SubagentLogTab'
import { TaskToolCard } from './messages/TaskToolCard'
import { WorkflowCard } from './messages/WorkflowCard'
import { registerWeChatSendCards } from './messages/WeChatSendCards'
import { watchPetReactions } from './petSignal'
import { registerApprovalBody, registerToolCard, registerToolIconPrefix } from './toolCards'

export function register(): void {
  watchPetReactions()
  // The shell tool belongs to the framework, so its transcript cards live here, not in a feature.
  registerToolCard('shell', ShellCard, 'detail', SquareTerminal)
  registerApprovalBody('shell', ShellApprovalBody)
  // So do the WeChat send tools: the approval and the expanded row show who receives what (one shared preview).
  registerWeChatSendCards()
  // task_* results link to the task's editor (the tasks feature owns the tab; the command opens it).
  registerToolCard('task_create', TaskToolCard)
  registerToolCard('task_update', TaskToolCard)
  // workflow_run lists its steps under the row (✓ ⟳ ○ !); MCP tools (mcp__server__tool) read as plugged-in tools.
  registerToolCard('workflow_run', WorkflowCard, 'inline', Workflow)
  registerToolIconPrefix('mcp__', Plug)
  // delegate_analysis lists its sub-agents under the row; each opens to its work, and its whole log opens as a tab.
  registerToolCard('delegate_analysis', DelegateCard, 'inline', Bot)
  registerTab({
    kind: 'agentRun',
    icon: 'bot',
    component: SubagentLogTab,
    title: (tab) => t('agent.subagent.tabTitle', { label: tab.title }),
  })
  onCommand('agent.quote', (payload) => void useAgentStore.getState().quote(payload))
  onCommand('agent.quoteText', (payload) => void useAgentStore.getState().quoteText(payload))
  onCommand('search.inPage', findInConversation)
  onCommand('agent.newThread', (payload) => void useAgentStore.getState().newThread(payload ?? {}))
  onCommand('agent.openThread', ({ threadId }) => {
    useAgentStore.getState().openThread(asThreadId(threadId))
    runCommand('agent.expand')
  })
}

export { AgentPanel } from './AgentPanel'
export { AgentWindow } from './window/AgentWindow'

export { useAgentPetSignal } from './petSignal'
