/**
 * Column widths + collapsed flags. Persisted in AppConfig.ui (configStore); this hook keeps a live copy
 * while a Resizer drags and writes back on release. Bounds mirror packages/protocol/src/config.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig } from '@aiwc/protocol'
import { useConfigStore } from '@/platform/configStore'

export interface WidthBounds {
  min: number
  max: number
  default: number
}

export const OBJECT_LIST_WIDTH: WidthBounds = { min: 240, max: 400, default: 280 }
export const AGENT_PANEL_WIDTH: WidthBounds = { min: 320, max: 640, default: 360 }
/** Collapsed Agent panel strip. */
export const AGENT_STRIP_WIDTH = 40
/** Collapsed ObjectList re-expand handle. */
export const LIST_HANDLE_WIDTH = 12

export const clampWidth = (value: number, bounds: WidthBounds): number => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))

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
  const listStart = useRef(cfgList)
  const agentStart = useRef(cfgAgent)
  const dragging = useRef<{ list: boolean; agent: boolean }>({ list: false, agent: false })

  // external changes (settings page, another window) win when not dragging
  useEffect(() => {
    if (!dragging.current.list) {
      setListWidth(cfgList)
      listStart.current = cfgList
    }
  }, [cfgList])
  useEffect(() => {
    if (!dragging.current.agent) {
      setAgentWidth(cfgAgent)
      agentStart.current = cfgAgent
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
    setListWidth(clampWidth(listStart.current + delta, OBJECT_LIST_WIDTH))
  }, [])
  // the agent column sits on the right: dragging its handle to the right shrinks it
  const resizeAgent = useCallback((delta: number) => {
    dragging.current.agent = true
    setAgentWidth(clampWidth(agentStart.current - delta, AGENT_PANEL_WIDTH))
  }, [])
  const commitList = useCallback(() => {
    dragging.current.list = false
    setListWidth((w) => {
      listStart.current = w
      if (w !== cfgList) persist({ objectListWidth: w })
      return w
    })
  }, [cfgList, persist])
  const commitAgent = useCallback(() => {
    dragging.current.agent = false
    setAgentWidth((w) => {
      agentStart.current = w
      if (w !== cfgAgent) persist({ agentPanelWidth: w })
      return w
    })
  }, [cfgAgent, persist])
  const resetList = useCallback(() => {
    listStart.current = OBJECT_LIST_WIDTH.default
    setListWidth(OBJECT_LIST_WIDTH.default)
    persist({ objectListWidth: OBJECT_LIST_WIDTH.default })
  }, [persist])
  const resetAgent = useCallback(() => {
    agentStart.current = AGENT_PANEL_WIDTH.default
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
