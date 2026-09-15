/**
 * Agent window column widths + the sidebar's collapsed flag (CLAUDE.md §12). Persisted in AppConfig.ui
 * (configStore); this hook keeps a live copy while a Resizer drags and writes back on release — the same
 * contract as columnLayout.ts for the four-column shell. Bounds mirror packages/protocol/src/config.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig } from '@aiwc/protocol'
import { useConfigStore } from '@/platform/configStore'
import { clampWidth, type WidthBounds } from './columnLayout'

export const AGENT_SIDEBAR_WIDTH: WidthBounds = { min: 220, max: 400, default: 260 }
export const AGENT_WORKSPACE_WIDTH: WidthBounds = { min: 400, max: 1200, default: 560 }
/** The conversation column never shrinks below this: the workspace pane yields first (AgentWindowFrame clamps it). */
export const AGENT_MAIN_MIN_WIDTH = 440

type Ui = AppConfig['ui']

export interface ResizableWidth {
  width: number
  /** Live resize (delta from drag start); `commit` persists. */
  resize(delta: number): void
  commit(): void
  reset(): void
}

function persist(patch: Partial<Ui>): void {
  void useConfigStore
    .getState()
    .set({ ui: patch })
    .catch(() => undefined)
}

/**
 * Live width while dragging, persisted through `save` on release. `direction` is -1 for a column on the
 * right edge (dragging its handle to the right shrinks it). Refs, not setState updaters, hold the drag
 * bookkeeping so StrictMode's double invocation cannot skew it (see columnLayout.ts).
 */
function useResizableWidth(
  cfg: number,
  bounds: WidthBounds,
  save: (width: number) => void,
  direction: 1 | -1,
): ResizableWidth {
  const [width, setWidth] = useState(cfg)
  const start = useRef(cfg)
  const live = useRef(cfg)
  const dragging = useRef(false)
  // external changes (settings page) win when not dragging
  useEffect(() => {
    if (dragging.current) return
    setWidth(cfg)
    start.current = cfg
    live.current = cfg
  }, [cfg])
  const resize = useCallback(
    (delta: number) => {
      dragging.current = true
      live.current = clampWidth(start.current + direction * delta, bounds)
      setWidth(live.current)
    },
    [bounds, direction],
  )
  const commit = useCallback(() => {
    dragging.current = false
    start.current = live.current
    if (live.current !== cfg) save(live.current)
  }, [cfg, save])
  const reset = useCallback(() => {
    start.current = bounds.default
    live.current = bounds.default
    setWidth(bounds.default)
    save(bounds.default)
  }, [bounds, save])
  return { width, resize, commit, reset }
}

export interface AgentWindowLayout {
  sidebar: ResizableWidth
  workspace: ResizableWidth
  sidebarCollapsed: boolean
  setSidebarCollapsed(collapsed: boolean): void
  toggleSidebar(): void
}

const saveSidebarWidth = (agentWindowSidebarWidth: number) => persist({ agentWindowSidebarWidth })
const saveWorkspaceWidth = (agentWindowWorkspaceWidth: number) => persist({ agentWindowWorkspaceWidth })

export function useAgentWindowLayout(ui: Ui | undefined): AgentWindowLayout {
  const sidebar = useResizableWidth(
    ui?.agentWindowSidebarWidth ?? AGENT_SIDEBAR_WIDTH.default,
    AGENT_SIDEBAR_WIDTH,
    saveSidebarWidth,
    1,
  )
  const workspace = useResizableWidth(
    ui?.agentWindowWorkspaceWidth ?? AGENT_WORKSPACE_WIDTH.default,
    AGENT_WORKSPACE_WIDTH,
    saveWorkspaceWidth,
    -1,
  )
  const sidebarCollapsed = ui?.agentWindowSidebarCollapsed ?? false
  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => persist({ agentWindowSidebarCollapsed: collapsed }),
    [],
  )
  const toggleSidebar = useCallback(() => {
    const current = useConfigStore.getState().config?.ui.agentWindowSidebarCollapsed ?? false
    persist({ agentWindowSidebarCollapsed: !current })
  }, [])
  return { sidebar, workspace, sidebarCollapsed, setSidebarCollapsed, toggleSidebar }
}
