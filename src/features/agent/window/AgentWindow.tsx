/**
 * AgentWindow — the full-window Agent layout (CLAUDE.md §12): AgentWindowFrame with the thread sidebar, the
 * header, the shared ThreadConversation, and the workspace pane — the ordinary Workspace, mounted always so
 * every `tab.*` command keeps its handler, shown while tabs are open. Owns the agent-mode meaning of the shell
 * commands: ⌘⇧B toggles the sidebar, ⌘K focuses the thread search, ⌘⇧J and ⌘1–4 return to the workbench,
 * agent.expand is a no-op (the window *is* the expanded Agent).
 */
import { useEffect } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
import { onCommand, runCommand } from '@/app/commands'
import { detectMac } from '@/app/shortcuts'
import { useLanguage, useT } from '@/i18n'
import { ErrorBoundary } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { useAgentWindowLayout } from '@/shell/agentWindowLayout'
import { AgentWindowFrame } from '@/shell/AgentWindowFrame'
import { useTabsStore } from '@/workspace/tabsStore'
import { Workspace } from '@/workspace/Workspace'
import { isUntitledTitle } from '../model'
import { ThreadConversation } from '../ThreadConversation'
import { useAgentSurface } from '../useAgentSurface'
import { AgentSidebar } from './AgentSidebar'
import { AgentWindowHeader } from './AgentWindowHeader'
import { useAgentWindowStore } from './agentWindowStore'

export interface AgentWindowProps {
  platform: AiwcBridge['platform']
  runtime: AiwcBridge['runtime']
}

export function AgentWindow({ platform, runtime }: AgentWindowProps) {
  const t = useT()
  useLanguage() // the window title (thread title / 新会话) follows the UI language
  const ui = useConfig((c) => c.ui)
  const layout = useAgentWindowLayout(ui)
  const surface = useAgentSurface({ collapsed: false })
  const mac = detectMac(platform)
  const tabCount = useTabsStore((s) => s.tabs.length)
  const openSeq = useTabsStore((s) => s.openSeq)
  const paneHidden = useAgentWindowStore((s) => s.paneHidden)
  const paneVisible = tabCount > 0 && !paneHidden
  const { toggleSidebar, setSidebarCollapsed, sidebarCollapsed } = layout
  const { store } = surface

  // A tab opened (or re-activated) from the conversation reveals the pane again; with no tabs there is nothing to hide.
  useEffect(() => {
    useAgentWindowStore.getState().setPaneHidden(false)
  }, [openSeq])
  useEffect(() => {
    if (tabCount === 0) useAgentWindowStore.getState().setPaneHidden(false)
  }, [tabCount])
  // Entering the window: the composer takes focus, exactly like expanding the panel.
  useEffect(() => {
    store().requestFocus()
  }, [store])

  useEffect(() => {
    const offs = [
      onCommand('objectList.toggleCollapsed', toggleSidebar),
      onCommand('agent.toggleCollapsed', () => runCommand('shell.setMode', { mode: 'workbench' })),
      // The window is the expanded Agent already; the command must still have a handler.
      onCommand('agent.expand', () => undefined),
      onCommand('rail.select', () => runCommand('shell.setMode', { mode: 'workbench' })),
      onCommand('search.sessions', () => {
        if (sidebarCollapsed) setSidebarCollapsed(false)
        const window = useAgentWindowStore.getState()
        window.setSidebarView('threads')
        window.requestSearchFocus()
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [setSidebarCollapsed, sidebarCollapsed, toggleSidebar])

  const title = surface.active
    ? isUntitledTitle(surface.active.title)
      ? t('agent.thread.untitled')
      : surface.active.title
    : undefined

  return (
    <AgentWindowFrame
      platform={platform}
      runtime={runtime}
      title={title}
      layout={layout}
      sidebar={
        <ErrorBoundary compact>
          <AgentSidebar surface={surface} mac={mac} />
        </ErrorBoundary>
      }
      header={
        <AgentWindowHeader
          surface={surface}
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          paneVisible={paneVisible}
          hasTabs={tabCount > 0}
          onTogglePane={() => useAgentWindowStore.getState().setPaneHidden(!paneHidden)}
        />
      }
      pane={<Workspace mac={mac} />}
      paneVisible={paneVisible}
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="agent-window-conversation">
        <ErrorBoundary compact>
          <ThreadConversation surface={surface} layout="window" />
        </ErrorBoundary>
      </div>
    </AgentWindowFrame>
  )
}
