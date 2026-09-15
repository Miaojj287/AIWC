import type { ReactNode } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { cn } from '@/kit'
import {
  AGENT_MAIN_MIN_WIDTH,
  AGENT_SIDEBAR_WIDTH,
  AGENT_WORKSPACE_WIDTH,
  type AgentWindowLayout,
} from './agentWindowLayout'
import { Resizer } from './Resizer'
import { WindowChrome } from './WindowChrome'
import './shell.css'

export interface AgentWindowFrameProps {
  platform: AiwcBridge['platform']
  runtime: AiwcBridge['runtime']
  /** Window title (the active thread). */
  title?: string
  layout: AgentWindowLayout
  /** Sidebar content (threads / scheduled tasks). Not rendered while collapsed. */
  sidebar: ReactNode
  /** h40 row above the conversation: sidebar toggle, thread title, actions, 工作台. Also the window drag region. */
  header: ReactNode
  /** The conversation column. */
  children: ReactNode
  /** Workspace pane content. Stays mounted while hidden so `tab.*` commands always have a handler. */
  pane: ReactNode
  paneVisible: boolean
}

/**
 * AgentWindowFrame — the Agent window's layout (CLAUDE.md §12, DESIGN-SPEC「Agent 窗口」): sidebar (config width,
 * collapsible) | conversation fill | workspace pane (config width, on demand). Layout only: the content of the
 * three regions comes from the agent feature. Only the conversation absorbs width; the pane is clamped so the
 * conversation keeps AGENT_MAIN_MIN_WIDTH. Ground colours follow the four-column shell: sidebar and conversation
 * on the panel ground, the header row on the shell ground like every tab strip.
 */
export function AgentWindowFrame({
  platform,
  runtime,
  title,
  layout,
  sidebar,
  header,
  children,
  pane,
  paneVisible,
}: AgentWindowFrameProps) {
  const t = useT()
  const { sidebar: sidebarWidth, workspace, sidebarCollapsed } = layout
  const sidebarPx = sidebarCollapsed ? 0 : sidebarWidth.width
  return (
    <div
      className="shell-root shell-agent-window relative flex h-full w-full flex-col overflow-hidden bg-shell text-fg"
      data-platform={platform}
      data-runtime={runtime}
      data-layout="agent"
      data-sidebar-collapsed={sidebarCollapsed}
      data-pane-visible={paneVisible}
    >
      <WindowChrome title={title} showControls={runtime === 'electron' && platform === 'darwin'} />
      <div className="flex min-h-0 flex-1 items-stretch">
        {sidebarCollapsed ? null : (
          <>
            <div
              className="shell-agent-sidebar flex h-full min-w-0 shrink-0 flex-col border-r border-line-6 bg-panel"
              style={{ width: sidebarWidth.width }}
              data-testid="agent-window-sidebar"
            >
              {sidebar}
            </div>
            <Resizer
              label={t('shell.agentWindow.resizeSidebar')}
              value={sidebarWidth.width}
              min={AGENT_SIDEBAR_WIDTH.min}
              max={AGENT_SIDEBAR_WIDTH.max}
              onResize={sidebarWidth.resize}
              onResizeEnd={sidebarWidth.commit}
              onReset={sidebarWidth.reset}
            />
          </>
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel" data-testid="agent-window-main">
          <div className="shell-agent-header flex h-10 shrink-0 items-center gap-1 border-b border-line-6 bg-shell px-2">
            {header}
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </section>
        {paneVisible ? (
          <Resizer
            label={t('shell.agentWindow.resizeWorkspace')}
            value={workspace.width}
            min={AGENT_WORKSPACE_WIDTH.min}
            max={AGENT_WORKSPACE_WIDTH.max}
            onResize={workspace.resize}
            onResizeEnd={workspace.commit}
            onReset={workspace.reset}
          />
        ) : null}
        <div
          hidden={!paneVisible}
          aria-hidden={!paneVisible || undefined}
          className={cn(
            'shell-agent-pane h-full min-w-0 shrink-0 border-l border-line-6',
            paneVisible ? 'flex' : 'hidden',
          )}
          // The pane yields before the conversation: never wider than what leaves AGENT_MAIN_MIN_WIDTH in the middle.
          style={
            paneVisible
              ? { width: `min(${workspace.width}px, calc(100vw - ${sidebarPx}px - ${AGENT_MAIN_MIN_WIDTH}px))` }
              : undefined
          }
          data-testid="agent-window-pane"
        >
          {pane}
        </div>
      </div>
    </div>
  )
}
