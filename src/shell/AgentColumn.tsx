import { Bot } from 'lucide-react'
import { useEffect } from 'react'
import { AgentPanel, useAgentPetSignal } from '@/features/agent'
import { AgentPet, openPetSettings, useCurrentPet } from '@/features/pets'
import { shortcutLabel } from '@/app/shortcuts'
import { useT } from '@/i18n'
import { cn, ErrorBoundary, IconButton, Tooltip } from '@/kit'
import { useConfig } from '@/platform/configStore'
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
  const t = useT()
  const unread = useShellStore((s) => s.agentUnread)
  const petConfig = useConfig((c) => c.pet)
  const pet = useCurrentPet(petConfig)
  const petSignal = useAgentPetSignal()
  useBridgeEvent('agent:event', (e) => {
    if (collapsed && UNREAD_EVENTS.has(e.type)) useShellStore.getState().setAgentUnread(true)
  })
  useEffect(() => {
    if (!collapsed) useShellStore.getState().setAgentUnread(false)
  }, [collapsed])

  return (
    <>
      {collapsed ? (
        <div
          className="shell-agent-strip flex h-full w-10 shrink-0 flex-col items-center border-l border-line-6 bg-panel pt-2"
          data-testid="agent-strip"
        >
          <Tooltip
            content={unread ? t('shell.agent.unread') : t('shell.agent.expand')}
            kbd={shortcutLabel('agent.toggleCollapsed', mac)}
            side="left"
          >
            <span className="relative inline-flex">
              <IconButton icon={Bot} label={t('shell.agent.expand')} onClick={onToggleCollapsed} active={unread} />
              {unread ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-chip bg-accent"
                />
              ) : null}
            </span>
          </Tooltip>
          {petConfig?.enabled && pet ? (
            // The collapsed strip keeps the pet as an ambient status light: it runs while the Agent works.
            // No room for an error state in 40px: a pet that fails to render is just left out.
            <ErrorBoundary fallback={null}>
              <AgentPet
                variant="mini"
                pet={pet}
                config={petConfig}
                signal={petSignal}
                onOpenSettings={openPetSettings}
                onActivate={onToggleCollapsed}
                className="mt-2"
              />
            </ErrorBoundary>
          ) : null}
        </div>
      ) : null}
      <div
        hidden={collapsed}
        aria-hidden={collapsed || undefined}
        style={collapsed ? undefined : { width }}
        className={cn(
          'shell-agent-panel h-full shrink-0 border-l border-line-6 bg-panel',
          collapsed ? 'hidden' : 'flex min-w-0 flex-col',
        )}
        data-testid="agent-panel"
      >
        <ErrorBoundary compact>
          <AgentPanel collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
        </ErrorBoundary>
      </div>
    </>
  )
}
