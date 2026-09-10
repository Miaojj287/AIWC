import { PanelLeftOpen } from 'lucide-react'
import { useEffect } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { detectMac, shortcutLabel } from '@/app/shortcuts'
import { IconButton, Tooltip } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { Workspace } from '@/workspace/Workspace'
import { useTabsStore } from '@/workspace/tabsStore'
import { AgentColumn } from './AgentColumn'
import { AGENT_PANEL_WIDTH, LIST_HANDLE_WIDTH, OBJECT_LIST_WIDTH, useColumnLayout } from './columnLayout'
import { IconRail } from './IconRail'
import { ObjectList } from './objectList/ObjectList'
import { Resizer } from './Resizer'
import { useShellStore } from './shellStore'
import { WindowChrome } from './WindowChrome'
import './shell.css'

export interface ShellProps {
  platform: AiwcBridge['platform']
  runtime: AiwcBridge['runtime']
}

/**
 * Shell — compact native window controls integrated into the four-column body (DESIGN-SPEC §0.1): IconRail 64 | ObjectList
 * (config width, collapsible to a 12px handle) | Workspace fill | AgentPanel (config width, collapsible
 * to a 40px strip). Only the Workspace absorbs width; only the body absorbs height.
 */
export function Shell({ platform, runtime }: ShellProps) {
  const mac = detectMac(platform)
  const ui = useConfig((c) => c.ui)
  const layout = useColumnLayout(ui)
  const activeTitle = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId)?.title)

  useEffect(() => {
    const offs = [
      onCommand('objectList.toggleCollapsed', layout.toggleList),
      onCommand('agent.toggleCollapsed', layout.toggleAgent),
      // ⌘K and a rail click both need the list visible
      onCommand('search.sessions', () => {
        if (layout.listCollapsed) layout.setListCollapsed(false)
        useShellStore.getState().requestSearchFocus()
      }),
      onCommand('rail.select', () => {
        if (layout.listCollapsed) layout.setListCollapsed(false)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [layout.toggleList, layout.toggleAgent, layout.setListCollapsed, layout.listCollapsed])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-shell text-fg" data-platform={platform} data-runtime={runtime} data-agent-collapsed={layout.agentCollapsed}>
      <WindowChrome title={activeTitle} showControls={runtime === 'electron' && platform === 'darwin'} />
      <div className="flex min-h-0 flex-1 items-stretch">
        <IconRail mac={mac} />
        {layout.listCollapsed ? (
          <div className="flex h-full shrink-0 border-r border-line-6 bg-panel" style={{ width: LIST_HANDLE_WIDTH }} data-testid="list-handle">
            <Tooltip content="展开列表" kbd={shortcutLabel('objectList.toggleCollapsed', mac)} side="right">
              <IconButton
                icon={PanelLeftOpen}
                label="展开列表"
                size="xs"
                iconSize={11}
                onClick={() => layout.setListCollapsed(false)}
                className="h-full w-3 items-start rounded-none pt-3 text-fg-3 hover:bg-hover-5 hover:text-fg"
              />
            </Tooltip>
          </div>
        ) : (
          <>
            <div className="h-full shrink-0 min-w-0" style={{ width: layout.listWidth }}>
              <ObjectList mac={mac} />
            </div>
            <Resizer
              label="调整列表宽度"
              value={layout.listWidth}
              min={OBJECT_LIST_WIDTH.min}
              max={OBJECT_LIST_WIDTH.max}
              onResize={layout.resizeList}
              onResizeEnd={layout.commitList}
              onReset={layout.resetList}
            />
          </>
        )}
        <Workspace />
        {layout.agentCollapsed ? null : (
          <Resizer
            label="调整 Agent 面板宽度"
            value={layout.agentWidth}
            min={AGENT_PANEL_WIDTH.min}
            max={AGENT_PANEL_WIDTH.max}
            onResize={layout.resizeAgent}
            onResizeEnd={layout.commitAgent}
            onReset={layout.resetAgent}
          />
        )}
        <AgentColumn collapsed={layout.agentCollapsed} width={layout.agentWidth} onToggleCollapsed={layout.toggleAgent} mac={mac} />
      </div>
    </div>
  )
}
