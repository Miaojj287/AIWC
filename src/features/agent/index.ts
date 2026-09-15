/**
 * Agent panel feature (DESIGN-SPEC §1.3, CLAUDE.md §5).
 *
 *   register()     — command handlers 'agent.quote' / 'agent.newThread' (nothing else)
 *   AgentPanel     — the right column (collapsed strip / tabs + messages + composer)
 *   MessageList    — transcript renderer, reused by the clone page
 *   Composer       — input card with @ / / popovers, reused by the clone page
 */
import { asThreadId } from '@aiwc/protocol'
import { onCommand, runCommand } from '@/app/commands'
import { useAgentStore } from './agentStore'
import { ShellApprovalBody, ShellCard } from './messages/ShellCards'
import { watchPetReactions } from './petSignal'
import { registerApprovalBody, registerToolCard } from './toolCards'

export function register(): void {
  watchPetReactions()
  // The shell tool belongs to the framework, so its transcript cards live here, not in a feature.
  registerToolCard('shell', ShellCard)
  registerApprovalBody('shell', ShellApprovalBody)
  onCommand('agent.quote', (payload) => void useAgentStore.getState().quote(payload))
  onCommand('agent.newThread', (payload) => void useAgentStore.getState().newThread(payload ?? {}))
  onCommand('agent.openThread', ({ threadId }) => {
    useAgentStore.getState().openThread(asThreadId(threadId))
    runCommand('agent.expand')
  })
}

export { AgentPanel } from './AgentPanel'
export { AgentWindow } from './window/AgentWindow'

export { useAgentPetSignal } from './petSignal'
