/**
 * Agent window header (h40, also the window drag region — CLAUDE.md §12), laid out like ZCode's: the sidebar toggle
 * while the sidebar is collapsed, the active thread's title (semibold, click → rename) with its context chip and the
 * ··· thread menu (the panel's, via threadMenus) right after it; on the right 新会话, the workspace-pane toggle and
 * the 「工作台」 pill back to the four-column layout. An empty thread has no title (nor a menu) yet: the left stays blank.
 */
import { ArrowUpRight, Ellipsis, PanelLeftOpen, PanelRight, PanelRightClose, Plus } from 'lucide-react'
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
  // A fresh thread is still 新会话 with nothing in it: ZCode's draft header shows no title, and neither do we.
  const isEmpty = Boolean(active && isUntitledTitle(active.title) && !surface.view?.items.length && !surface.streaming)
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
        {active && !isEmpty ? (
          <>
            <Tooltip content={t('agent.window.header.rename')}>
              <button
                type="button"
                onClick={() => onAction('rename', active.threadId)}
                className="flex h-7 min-w-0 max-w-[360px] items-center rounded-control px-1.5 text-left outline-none hover:bg-hover-5"
                data-testid="agent-window-title"
              >
                <span className="min-w-0 truncate text-body font-semibold text-fg">{title}</span>
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
        {active && !isEmpty ? (
          <DropdownMenu>
            <Tooltip content={t('agent.window.header.menu')}>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('agent.window.header.menu')} className="text-fg-2" />
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[228px]">
              <DropdownMenuItems items={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={t('agent.window.header.newThread')} kbd={shortcutLabel('agent.newThread', mac)}>
          <IconButton
            size="sm"
            icon={Plus}
            label={t('agent.window.header.newThread')}
            onClick={() => void store().newThread()}
            className="text-fg-2"
          />
        </Tooltip>
        <Tooltip content={paneTip}>
          {/* A disabled button emits no pointer events; the span keeps the hint reachable. */}
          <span className="inline-flex">
            <IconButton
              size="sm"
              icon={paneVisible ? PanelRightClose : PanelRight}
              label={paneVisible ? t('agent.window.header.hidePane') : t('agent.window.header.showPane')}
              disabled={!hasTabs}
              onClick={onTogglePane}
              aria-pressed={paneVisible}
              className={paneVisible ? 'text-fg' : 'text-fg-2'}
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
