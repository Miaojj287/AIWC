import { describe, expect, it } from 'vitest'
import type { MobileStatus } from '@aiwc/protocol'
import { connectionView } from './mobileModel'

const base: MobileStatus = {
  state: 'needs_login',
  scanned: false,
  ownerUnknown: false,
  persisted: true,
  remote: { enabled: false, permissionMode: 'ask', running: false, pendingApprovals: 0 },
}

describe('connectionView', () => {
  it('offers connect when not logged in', () => {
    expect(connectionView(base)).toMatchObject({ action: 'connect', ready: false, showQr: false })
  })

  it('shows the QR while waiting for a scan, and hides it once scanned', () => {
    expect(connectionView({ ...base, state: 'connecting' })).toMatchObject({ action: 'cancel', showQr: true })
    expect(connectionView({ ...base, state: 'connecting', scanned: true })).toMatchObject({
      action: 'cancel',
      showQr: false,
      badge: { label: 'mobile.settings.state.scanned' },
    })
  })

  it('is ready only when connected as a known owner', () => {
    expect(connectionView({ ...base, state: 'connected', owner: 'a…b' })).toMatchObject({
      ready: true,
      action: 'manage',
    })
    expect(connectionView({ ...base, state: 'connected', ownerUnknown: true })).toMatchObject({
      ready: false,
      badge: { tone: 'warn' },
    })
  })

  it('reconnects a kept login', () => {
    expect(connectionView({ ...base, state: 'disconnected', owner: 'a…b' })).toMatchObject({ action: 'reconnect' })
    expect(connectionView({ ...base, state: 'error', owner: 'a…b' })).toMatchObject({
      action: 'reconnect',
      badge: { tone: 'danger' },
    })
  })
})
