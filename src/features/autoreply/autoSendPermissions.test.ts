import { describe, expect, it } from 'vitest'
import type { AutoSendPermissions } from '@aiwc/protocol'
import { blockingPermissions, paneForHalt } from './autoSendPermissions'

const perms = (patch: Partial<AutoSendPermissions>): AutoSendPermissions => ({
  platform: 'darwin',
  accessibility: 'granted',
  automation: 'unknown',
  ready: true,
  checkedAt: 0,
  ...patch,
})

describe('auto-send permission helpers', () => {
  it('lists only what blocks sending: denied or invalidated by an update', () => {
    expect(blockingPermissions(perms({}))).toEqual([])
    expect(blockingPermissions(perms({ accessibility: 'stale', automation: 'denied' }))).toEqual([
      'accessibility',
      'automation',
    ])
    expect(blockingPermissions(undefined)).toEqual([])
  })

  it('maps a halt code (not its text) to the settings pane that fixes it', () => {
    expect(paneForHalt('no-permission')).toBe('accessibility')
    expect(paneForHalt('automation-denied')).toBe('automation')
    expect(paneForHalt('wrong-session')).toBeUndefined()
    expect(paneForHalt(undefined)).toBeUndefined()
  })
})
