import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAutoSendPermissions, permissionMemoryFile, type PermissionMemory } from './autoSendPermissions'

function setup(opts: { platform?: NodeJS.Platform; trusted: boolean; fingerprint: string; memory?: PermissionMemory }) {
  let memory: PermissionMemory = opts.memory ?? {}
  const state = { trusted: opts.trusted, fingerprint: opts.fingerprint }
  const service = createAutoSendPermissions({
    platform: opts.platform ?? 'darwin',
    isAccessibilityTrusted: () => state.trusted,
    fingerprint: () => state.fingerprint,
    load: () => memory,
    save: (next) => {
      memory = next
    },
    now: () => 1,
  })
  return { service, state, memory: () => memory }
}

describe('auto-send permissions', () => {
  it('reports a live Accessibility grant and remembers the build it was granted to', () => {
    const { service, memory } = setup({ trusted: true, fingerprint: '1.0|/A' })
    expect(service.check()).toMatchObject({ accessibility: 'granted', automation: 'unknown', ready: true })
    expect(memory().accessibilityGrantedFor).toBe('1.0|/A')
  })

  it('tells a grant invalidated by an update (stale) from one never given (denied)', () => {
    const updated = setup({ trusted: false, fingerprint: '1.1|/A', memory: { accessibilityGrantedFor: '1.0|/A' } })
    expect(updated.service.check()).toMatchObject({ accessibility: 'stale', ready: false })
    const never = setup({ trusted: false, fingerprint: '1.1|/A' })
    expect(never.service.check().accessibility).toBe('denied')
    const revoked = setup({ trusted: false, fingerprint: '1.0|/A', memory: { accessibilityGrantedFor: '1.0|/A' } })
    expect(revoked.service.check().accessibility).toBe('denied')
  })

  it('learns Automation from real attempts: a denial halts readiness, a verified send restores it', () => {
    const { service } = setup({ trusted: true, fingerprint: 'f' })
    service.noteHalt('automation-denied')
    expect(service.check()).toMatchObject({ automation: 'denied', ready: false })
    service.noteVerifiedSend()
    expect(service.check()).toMatchObject({ automation: 'granted', ready: true })
  })

  it('needs nothing on Windows and cannot send on Linux', () => {
    expect(setup({ platform: 'win32', trusted: false, fingerprint: 'f' }).service.check()).toMatchObject({
      accessibility: 'not-applicable',
      ready: true,
    })
    expect(setup({ platform: 'linux', trusted: false, fingerprint: 'f' }).service.check().ready).toBe(false)
  })
})

describe('permissionMemoryFile', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips and drops malformed fields', () => {
    dir = mkdtempSync(join(tmpdir(), 'aiwc-perm-'))
    const file = permissionMemoryFile(join(dir, 'p.json'))
    file.save({ accessibilityGrantedFor: 'x', automation: 'granted' })
    expect(file.load()).toEqual({ accessibilityGrantedFor: 'x', automation: 'granted' })
    writeFileSync(join(dir, 'p.json'), JSON.stringify({ accessibilityGrantedFor: 3, automation: 'maybe' }))
    expect(file.load()).toEqual({})
  })
})
