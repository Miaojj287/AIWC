/**
 * Column widths + collapsed flags. Persisted in AppConfig.ui (configStore); this hook keeps a live copy
 * while a Resizer drags and writes back on release. Bounds mirror packages/protocol/src/config.ts.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppConfig } from '@aiwc/protocol'
import { useConfigStore } from '@/platform/configStore'

export interface WidthBounds {
  min: number
  max: number
  default: number
}

export const OBJECT_LIST_WIDTH: WidthBounds = { min: 240, max: 400, default: 280 }
export const AGENT_PANEL_WIDTH: WidthBounds = { min: 320, max: 640, default: 360 }
/** Collapsed ObjectList re-expand handle: wide enough to be a real pointer target (24px). */
export const LIST_HANDLE_WIDTH = 24
/** The IconRail (tokens.css `--w-rail`). */
export const RAIL_WIDTH = 64
/** Collapsed Agent strip (AgentColumn). */
export const AGENT_STRIP_WIDTH = 40
/** The workspace keeps at least this much: tabs, headers and editors are laid out for 400px and up. */
export const WORKSPACE_MIN_WIDTH = 400

export interface ColumnFitInput {
  viewport: number
  listWidth: number
  agentWidth: number
  listCollapsed: boolean
  agentCollapsed: boolean
}

/**
 * Saved widths were chosen on some window size; at the minimum window (or after a resize) list 400 + Agent 640
 * would leave the workspace 96px. The Agent panel yields first, then the list, each down to its own minimum, so
 * the workspace keeps WORKSPACE_MIN_WIDTH whenever the window allows it. Saved values are not rewritten.
 */
export function fitColumns(input: ColumnFitInput): { listWidth: number; agentWidth: number } {
  const listMin = OBJECT_LIST_WIDTH.min
  const agentMin = AGENT_PANEL_WIDTH.min
  const list = input.listCollapsed ? LIST_HANDLE_WIDTH : input.listWidth
  const agent = input.agentCollapsed ? AGENT_STRIP_WIDTH : input.agentWidth
  let over = RAIL_WIDTH + list + agent + WORKSPACE_MIN_WIDTH - input.viewport
  let listWidth = input.listWidth
  let agentWidth = input.agentWidth
  if (over > 0 && !input.agentCollapsed) {
    const give = Math.min(over, Math.max(0, agentWidth - agentMin))
    agentWidth -= give
    over -= give
  }
  if (over > 0 && !input.listCollapsed) {
    const give = Math.min(over, Math.max(0, listWidth - listMin))
    listWidth -= give
  }
  return { listWidth, agentWidth }
}

const subscribeViewport = (notify: () => void) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}

/** The window's inner width, re-read on resize. */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribeViewport,
    () => window.innerWidth,
    () => 1440,
  )
}

export const clampWidth = (value: number, bounds: WidthBounds): number =>
  Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))

export interface ColumnLayout {
  listWidth: number
  agentWidth: number
  listCollapsed: boolean
  agentCollapsed: boolean
  /** Live resize (delta from drag start); `commit` persists. */
  resizeList(delta: number): void
  resizeAgent(delta: number): void
  commitList(): void
  commitAgent(): void
  resetList(): void
  resetAgent(): void
  setListCollapsed(collapsed: boolean): void
  setAgentCollapsed(collapsed: boolean): void
  toggleList(): void
  toggleAgent(): void
}

type Ui = AppConfig['ui']

export function useColumnLayout(ui: Ui | undefined): ColumnLayout {
  const cfgList = ui?.objectListWidth ?? OBJECT_LIST_WIDTH.default
  const cfgAgent = ui?.agentPanelWidth ?? AGENT_PANEL_WIDTH.default
  const listCollapsed = ui?.objectListCollapsed ?? false
  const agentCollapsed = ui?.agentPanelCollapsed ?? false

  const [listWidth, setListWidth] = useState(cfgList)
  const [agentWidth, setAgentWidth] = useState(cfgAgent)
  // Width at drag start and the width last applied, per column. Only handlers and effects write them: setState
  // updaters stay pure (StrictMode runs them twice), and a keyboard nudge commits before any re-render.
  const listStart = useRef(cfgList)
  const agentStart = useRef(cfgAgent)
  const listLive = useRef(cfgList)
  const agentLive = useRef(cfgAgent)
  const dragging = useRef<{ list: boolean; agent: boolean }>({ list: false, agent: false })

  // external changes (settings page, another window) win when not dragging
  useEffect(() => {
    if (!dragging.current.list) {
      setListWidth(cfgList)
      listStart.current = cfgList
      listLive.current = cfgList
    }
  }, [cfgList])
  useEffect(() => {
    if (!dragging.current.agent) {
      setAgentWidth(cfgAgent)
      agentStart.current = cfgAgent
      agentLive.current = cfgAgent
    }
  }, [cfgAgent])

  const persist = useCallback((patch: Partial<Ui>) => {
    void useConfigStore
      .getState()
      .set({ ui: patch })
      .catch(() => undefined)
  }, [])

  const resizeList = useCallback((delta: number) => {
    dragging.current.list = true
    listLive.current = clampWidth(listStart.current + delta, OBJECT_LIST_WIDTH)
    setListWidth(listLive.current)
  }, [])
  // the agent column sits on the right: dragging its handle to the right shrinks it
  const resizeAgent = useCallback((delta: number) => {
    dragging.current.agent = true
    agentLive.current = clampWidth(agentStart.current - delta, AGENT_PANEL_WIDTH)
    setAgentWidth(agentLive.current)
  }, [])
  const commitList = useCallback(() => {
    dragging.current.list = false
    const width = listLive.current
    listStart.current = width
    if (width !== cfgList) persist({ objectListWidth: width })
  }, [cfgList, persist])
  const commitAgent = useCallback(() => {
    dragging.current.agent = false
    const width = agentLive.current
    agentStart.current = width
    if (width !== cfgAgent) persist({ agentPanelWidth: width })
  }, [cfgAgent, persist])
  const resetList = useCallback(() => {
    listStart.current = OBJECT_LIST_WIDTH.default
    listLive.current = OBJECT_LIST_WIDTH.default
    setListWidth(OBJECT_LIST_WIDTH.default)
    persist({ objectListWidth: OBJECT_LIST_WIDTH.default })
  }, [persist])
  const resetAgent = useCallback(() => {
    agentStart.current = AGENT_PANEL_WIDTH.default
    agentLive.current = AGENT_PANEL_WIDTH.default
    setAgentWidth(AGENT_PANEL_WIDTH.default)
    persist({ agentPanelWidth: AGENT_PANEL_WIDTH.default })
  }, [persist])

  const setListCollapsed = useCallback((collapsed: boolean) => persist({ objectListCollapsed: collapsed }), [persist])
  const setAgentCollapsed = useCallback((collapsed: boolean) => persist({ agentPanelCollapsed: collapsed }), [persist])
  const toggleList = useCallback(() => {
    const cur = useConfigStore.getState().config?.ui.objectListCollapsed ?? false
    persist({ objectListCollapsed: !cur })
  }, [persist])
  const toggleAgent = useCallback(() => {
    const cur = useConfigStore.getState().config?.ui.agentPanelCollapsed ?? false
    persist({ agentPanelCollapsed: !cur })
  }, [persist])

  return {
    listWidth,
    agentWidth,
    listCollapsed,
    agentCollapsed,
    resizeList,
    resizeAgent,
    commitList,
    commitAgent,
    resetList,
    resetAgent,
    setListCollapsed,
    setAgentCollapsed,
    toggleList,
    toggleAgent,
  }
}
