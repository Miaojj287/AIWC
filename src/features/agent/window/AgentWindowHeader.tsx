/**
 * Agent window header (h40, also the window drag region — CLAUDE.md §12): the sidebar toggle while the
 * sidebar is collapsed, the active thread's title (click → rename) with its context chip, then 新会话, the
 * ··· thread menu (the panel's, via threadMenus), the workspace-pane toggle and the 「工作台」 pill back to
 * the four-column layout.
 */
import { ArrowUpRight, Ellipsis, MessageSquare, PanelLeftOpen, PanelRight, PanelRightClose, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { runCommand } from '@/app/commands'
import { shortcutLabel } from '@/app/shortcuts'
import { useT } from '@/i18n'
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  ICON_STROKE,
  IconButton,
  Tooltip,
} from '@/kit'
import { mentionFromContextRef } from '../contextRef'
import { MENTION_ICON, openMention } from '../messages/mentionChips'
import { isUntitledTitle } from '../model'
import { activeThreadMenu } from '../threadMenus'
import type { AgentSurface } from '../useAgentSurface'

export interface AgentWindowHeaderProps {
  surface: AgentSurface
  sidebarCollapsed: boolean
  onExpandSidebar: () => void
  paneVisible: boolean
  /** Any workspace tab open? Without one the pane toggle is disabled and explains itself. */
  hasTabs: boolean
  onTogglePane: () => void
}

export function AgentWindowHeader({
  surface,
  sidebarCollapsed,
  onExpandSidebar,
  paneVisible,
  hasTabs,
  onTogglePane,
}: AgentWindowHeaderProps) {
  const t = useT()
  const { active, saved, mac, onAction, store } = surface
  const isSaved = Boolean(active && saved.some((thread) => thread.threadId === active.threadId))
  const menu = useMemo(
    () => activeThreadMenu(t, active, isSaved, { onAction, onPin: (id, pinned) => void store().pin(id, pinned) }),
    [active, isSaved, onAction, store, t],
  )
  const title = active ? (isUntitledTitle(active.title) ? t('agent.thread.untitled') : active.title) : ''
  const contextRef = active?.contextRef
  const paneTip = !hasTabs
    ? t('agent.window.header.noPane')
    : paneVisible
      ? t('agent.window.header.hidePane')
      : t('agent.window.header.showPane')

  return (
    <>
      {sidebarCollapsed ? (
        <Tooltip content={t('agent.window.sidebar.expand')} kbd={shortcutLabel('objectList.toggleCollapsed', mac)}>
          <IconButton
            size="sm"
            icon={PanelLeftOpen}
            label={t('agent.window.sidebar.expand')}
            onClick={onExpandSidebar}
          />
        </Tooltip>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
        {active ? (
          <>
            <Tooltip content={t('agent.window.header.rename')}>
              <button
                type="button"
                onClick={() => onAction('rename', active.threadId)}
                className="flex h-7 min-w-0 max-w-[360px] items-center gap-1.5 rounded-control px-1.5 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-hover-5 focus-visible:ring-2 focus-visible:ring-accent/70"
                data-testid="agent-window-title"
              >
                <MessageSquare size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
                <span className="min-w-0 truncate text-tab font-medium text-fg">{title}</span>
              </button>
            </Tooltip>
            {contextRef ? (
              <Chip
                variant="mention"
                icon={MENTION_ICON[contextRef.kind]}
                label={contextRef.label}
                title={t('agent.window.header.context', { label: contextRef.label })}
                onClick={() => openMention(mentionFromContextRef(contextRef))}
                className="h-5 max-w-[200px] text-micro"
              />
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={t('agent.window.header.newThread')} kbd={shortcutLabel('agent.newThread', mac)}>
          <IconButton
            size="sm"
            icon={Plus}
            label={t('agent.window.header.newThread')}
            onClick={() => void store().newThread()}
          />
        </Tooltip>
        <DropdownMenu>
          <Tooltip content={t('agent.window.header.menu')}>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" icon={Ellipsis} label={t('agent.window.header.menu')} />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-[228px]">
            <DropdownMenuItems items={menu} />
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content={paneTip}>
          {/* A disabled button emits no pointer events; the span keeps the hint reachable. */}
          <span className="inline-flex">
            <IconButton
              size="sm"
              icon={paneVisible ? PanelRightClose : PanelRight}
              label={paneVisible ? t('agent.window.header.hidePane') : t('agent.window.header.showPane')}
              active={paneVisible}
              disabled={!hasTabs}
              onClick={onTogglePane}
              data-testid="agent-window-pane-toggle"
            />
          </span>
        </Tooltip>
        <Tooltip content={t('agent.window.backTip')} kbd={shortcutLabel('shell.toggleMode', mac)}>
          <Button
            variant="outline"
            size="sm"
            trailingIcon={ArrowUpRight}
            onClick={() => runCommand('shell.setMode', { mode: 'workbench' })}
            className="ml-1"
            data-testid="agent-window-back"
          >
            {t('agent.window.back')}
          </Button>
        </Tooltip>
      </div>
    </>
  )
}
