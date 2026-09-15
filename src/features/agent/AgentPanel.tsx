/**
 * AgentPanel — the always-present right column (CLAUDE.md §1, §5): thread tabs → ThreadConversation
 * (message list, composer with its toolbar, pet, dialogs). Collapsed it renders a 40px strip with the bot
 * button and unread dot. State and actions come from useAgentSurface, which the Agent window shares
 * (CLAUDE.md §12); nothing here talks to the bridge directly.
 */
import { Bot } from 'lucide-react'
import { runCommand } from '@/app/commands'
import { shortcutLabel } from '@/app/shortcuts'
import { useT } from '@/i18n'
import { IconButton, Tooltip } from '@/kit'
import { useShellStore } from '@/shell/shellStore'
import { ThreadConversation } from './ThreadConversation'
import { ThreadTabs } from './ThreadTabs'
import { useAgentSurface } from './useAgentSurface'

export interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function AgentPanel({ collapsed, onToggleCollapsed }: AgentPanelProps) {
  const t = useT()
  const unread = useShellStore((s) => s.agentUnread)
  const surface = useAgentSurface({ collapsed })
  const { store, mac } = surface

  if (collapsed) {
    return (
      <div
        className="flex h-full w-10 shrink-0 flex-col items-center border-l border-line-6 bg-panel pt-2"
        data-testid="agent-panel-strip"
      >
        <Tooltip
          content={unread ? t('agent.panel.unread') : t('agent.panel.expand')}
          kbd={shortcutLabel('agent.toggleCollapsed', mac)}
          side="left"
        >
          <span className="relative inline-flex">
            <IconButton icon={Bot} label={t('agent.panel.expand')} onClick={onToggleCollapsed} active={unread} />
            {unread ? (
              <span
                aria-hidden
                className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-chip bg-accent"
              />
            ) : null}
          </span>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel" data-testid="agent-panel-root">
      <ThreadTabs
        open={surface.open}
        all={surface.saved}
        activeId={surface.activeThreadId}
        mac={mac}
        onSelect={(id) => store().setActive(id)}
        onClose={(id) => store().closeThread(id)}
        onCloseOthers={(id) => store().closeOtherThreads(id)}
        onNew={() => void store().newThread()}
        onPin={(id, pinned) => void store().pin(id, pinned)}
        onAction={surface.onAction}
        onToggleCollapsed={onToggleCollapsed}
        onOpenWindow={() => runCommand('shell.setMode', { mode: 'agent' })}
      />
      <ThreadConversation surface={surface} layout="panel" />
    </div>
  )
}
