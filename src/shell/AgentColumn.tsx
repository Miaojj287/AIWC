import { Bot } from 'lucide-react'
import { useEffect } from 'react'
import { AgentPanel } from '@/features/agent'
import { shortcutLabel } from '@/app/shortcuts'
import { cn, IconButton, Tooltip } from '@/kit'
import { useBridgeEvent } from '@/platform/hooks'
import { useShellStore } from './shellStore'

export interface AgentColumnProps {
  collapsed: boolean
  width: number
  onToggleCollapsed(): void
  mac: boolean
}

/** Agent events that count as "something new arrived" while the panel is collapsed. */
const UNREAD_EVENTS = new Set(['text.end', 'turn.completed', 'approval.requested', 'error'])

/**
 * AgentColumn — the always-present Agent panel (CLAUDE.md §1, §5). Expanded: panel ground, 1px line on
 * the left, width from config. Collapsed: a 40px strip with the bot button (+ unread dot). The panel
 * itself stays mounted while collapsed so thread state survives; it is just hidden.
 */
export function AgentColumn({ collapsed, width, onToggleCollapsed, mac }: AgentColumnProps) {
  const unread = useShellStore((s) => s.agentUnread)
  useBridgeEvent('agent:event', (e) => {
    if (collapsed && UNREAD_EVENTS.has(e.type)) useShellStore.getState().setAgentUnread(true)
  })
  useEffect(() => {
    if (!collapsed) useShellStore.getState().setAgentUnread(false)
  }, [collapsed])

  return (
    <>
      {collapsed ? (
        <div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-line-6 bg-panel pt-2" data-testid="agent-strip">
          <Tooltip content={unread ? 'Agent 有新消息' : '展开 Agent 面板'} kbd={shortcutLabel('agent.toggleCollapsed', mac)} side="left">
            <span className="relative inline-flex">
              <IconButton icon={Bot} label="展开 Agent 面板" onClick={onToggleCollapsed} active={unread} />
              {unread ? <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-chip bg-accent" /> : null}
            </span>
          </Tooltip>
        </div>
      ) : null}
      <div
        hidden={collapsed}
        aria-hidden={collapsed || undefined}
        style={collapsed ? undefined : { width }}
        className={cn('h-full shrink-0 border-l border-line-6 bg-panel', collapsed ? 'hidden' : 'flex min-w-0 flex-col')}
        data-testid="agent-panel"
      >
        <AgentPanel collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      </div>
    </>
  )
}
