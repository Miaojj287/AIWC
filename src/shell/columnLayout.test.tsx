// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge, type AppConfig, type ConfigPatch } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfig, useConfigStore } from '@/platform/configStore'
import { AGENT_PANEL_WIDTH, OBJECT_LIST_WIDTH, useColumnLayout } from './columnLayout'

let writes: ConfigPatch[]

function fakeBridge(): AiwcBridge {
  let current: AppConfig = defaultConfig()
  return {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string, req: unknown) => {
      if (channel === 'config:get') return current
      if (channel === 'config:set') {
        const patch = req as ConfigPatch
        writes.push(patch)
        current = { ...current, ui: { ...current.ui, ...patch.ui } }
        return current
      }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

/** The Shell's wiring: live widths from the hook, persisted widths from the config store, under StrictMode. */
const mountLayout = () => renderHook(() => useColumnLayout(useConfig((c) => c.ui)), { wrapper: StrictMode })

beforeEach(async () => {
  writes = []
  __resetConfigStoreForTests()
  __setBridgeForTests(fakeBridge())
  await useConfigStore.getState().hydrate()
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('useColumnLayout', () => {
  it('writes a dragged list width once on release, even under StrictMode', async () => {
    const { result } = mountLayout()
    act(() => result.current.resizeList(40))
    expect(result.current.listWidth).toBe(OBJECT_LIST_WIDTH.default + 40)
    expect(writes).toEqual([])
    await act(async () => result.current.commitList())
    expect(writes).toEqual([{ ui: { objectListWidth: OBJECT_LIST_WIDTH.default + 40 } }])
    expect(result.current.listWidth).toBe(OBJECT_LIST_WIDTH.default + 40)
  })

  it('persists a keyboard nudge (resize + commit in one handler) once with the new width', async () => {
    const { result } = mountLayout()
    await act(async () => {
      result.current.resizeAgent(-16)
      result.current.commitAgent()
    })
    expect(writes).toEqual([{ ui: { agentPanelWidth: AGENT_PANEL_WIDTH.default + 16 } }])
    // the next nudge starts from the committed width, not from the drag start
    await act(async () => {
      result.current.resizeAgent(-16)
      result.current.commitAgent()
    })
    expect(writes.at(-1)).toEqual({ ui: { agentPanelWidth: AGENT_PANEL_WIDTH.default + 32 } })
    expect(writes).toHaveLength(2)
    expect(result.current.agentWidth).toBe(AGENT_PANEL_WIDTH.default + 32)
  })

  it('does not write when the drag ends where it started', async () => {
    const { result } = mountLayout()
    act(() => result.current.resizeList(0))
    await act(async () => result.current.commitList())
    expect(writes).toEqual([])
  })
})
