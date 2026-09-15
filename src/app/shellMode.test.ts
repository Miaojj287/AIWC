// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge, type AppConfig, type ConfigPatch } from '@aiwc/protocol'
import { clearToasts, getToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { runCommand } from './commands'
import { installShellModeCommands, nextShellMode } from './shellMode'

let failingWrites = 0

function fakeBridge(): AiwcBridge {
  let current: AppConfig = defaultConfig()
  return {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string, req: unknown) => {
      if (channel === 'config:get') return current
      if (channel === 'config:set') {
        if (failingWrites > 0) {
          failingWrites--
          throw new Error('磁盘已满')
        }
        const patch = req as ConfigPatch
        current = { ...current, ui: { ...current.ui, ...patch.ui } }
        return current
      }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

const flush = () => act(async () => {})
const mode = () => useConfigStore.getState().config?.ui.shellMode

beforeEach(async () => {
  failingWrites = 0
  __resetConfigStoreForTests()
  clearToasts()
  __setBridgeForTests(fakeBridge())
  await useConfigStore.getState().hydrate()
})
afterEach(() => {
  __setBridgeForTests(undefined)
  clearToasts()
})

describe('nextShellMode', () => {
  it('flips between the workbench and the Agent window, defaulting to the Agent window from nothing', () => {
    expect(nextShellMode('workbench')).toBe('agent')
    expect(nextShellMode('agent')).toBe('workbench')
    expect(nextShellMode(undefined)).toBe('agent')
  })
})

describe('installShellModeCommands', () => {
  it('persists ui.shellMode for shell.toggleMode and shell.setMode', async () => {
    const off = installShellModeCommands()
    try {
      runCommand('shell.toggleMode')
      await flush()
      expect(mode()).toBe('agent')
      runCommand('shell.setMode', { mode: 'workbench' })
      await flush()
      expect(mode()).toBe('workbench')
      runCommand('shell.setMode', { mode: 'workbench' })
      await flush()
      expect(mode()).toBe('workbench')
    } finally {
      off()
    }
  })

  it('rolls back and reports a failed save', async () => {
    failingWrites = 1
    const off = installShellModeCommands()
    try {
      runCommand('shell.setMode', { mode: 'agent' })
      await flush()
      expect(mode()).toBe('workbench')
      expect(getToasts().some((t) => t.kind === 'error' && t.text === '切换布局失败')).toBe(true)
    } finally {
      off()
    }
  })
})
