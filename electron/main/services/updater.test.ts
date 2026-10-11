import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@aiwc/protocol'
import { createUpdater, updateUnavailableReason, type AutoUpdaterLike, type UpdaterDeps } from './updater'

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  next: 'available' | 'none' | 'error' = 'none'
  checkForUpdates = vi.fn(async () => {
    this.emit('checking-for-update')
    if (this.next === 'available') this.emit('update-available', { version: '0.2.0' })
    else if (this.next === 'none') this.emit('update-not-available', { version: '0.1.0' })
    else throw new Error('feed unreachable')
    return null
  })
  downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 50 })
    this.emit('update-downloaded', { version: '0.2.0' })
    return []
  })
  quitAndInstall = vi.fn()
}

function setup(over: Partial<UpdaterDeps> = {}) {
  const fake = new FakeAutoUpdater()
  const emitted: UpdateStatus[] = []
  const deps: UpdaterDeps = {
    isPackaged: true,
    platform: 'win32',
    hasFeed: () => true,
    appVersion: '0.1.0',
    load: vi.fn(async () => fake),
    emit: (s) => emitted.push(s),
    logger: { info: vi.fn(), warn: vi.fn() },
    unavailableError: (reason) => new Error(`unavailable:${reason}`),
    stateError: (what) => new Error(`state:${what}`),
    timeoutError: () => new Error('timeout'),
    ...over,
  }
  return { fake, emitted, deps, updater: createUpdater(deps) }
}

describe('updateUnavailableReason', () => {
  it('explains why a build cannot update', () => {
    const base = { isPackaged: true, platform: 'darwin' as const, hasFeed: () => true }
    expect(updateUnavailableReason({ ...base, isPackaged: false })).toBe('dev_build')
    expect(updateUnavailableReason({ ...base, hasFeed: () => false })).toBe('no_feed')
    expect(updateUnavailableReason({ ...base, platform: 'linux' })).toBe('unsupported_platform')
    expect(updateUnavailableReason({ ...base, platform: 'linux', appImage: '/x.AppImage' })).toBe(null)
    expect(updateUnavailableReason(base)).toBe(null)
  })
})

describe('createUpdater', () => {
  it('never claims "up to date" when it cannot check, and never loads electron-updater', async () => {
    const { updater, deps } = setup({ hasFeed: () => false })
    expect(updater.state()).toEqual({ status: { state: 'idle' }, unavailable: 'no_feed' })
    await expect(updater.check()).rejects.toThrow('unavailable:no_feed')
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('check → available → download with progress → ready → install', async () => {
    const { updater, fake, emitted } = setup()
    fake.next = 'available'
    expect(await updater.check()).toEqual({ state: 'available', version: '0.2.0' })
    expect(fake.autoDownload).toBe(false)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    await updater.download()
    expect(emitted).toContainEqual({ state: 'downloading', version: '0.2.0', progress: 0.5 })
    expect(updater.state().status).toEqual({ state: 'ready', version: '0.2.0' })
    updater.install()
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports up to date only when the feed said so, and errors as errors', async () => {
    const { updater, fake } = setup()
    expect(await updater.check()).toEqual({ state: 'up_to_date', version: '0.1.0' })
    fake.next = 'error'
    expect(await updater.check()).toEqual({ state: 'error', error: 'feed unreachable' })
  })

  it('refuses download / install out of order', async () => {
    const { updater } = setup()
    await updater.check()
    await expect(updater.download()).rejects.toThrow('state:download')
    expect(() => updater.install()).toThrow('state:install')
  })

  it('tells the user once when a background check finds an update', async () => {
    const onBackgroundAvailable = vi.fn()
    const { updater, fake } = setup({ onBackgroundAvailable })
    fake.next = 'available'
    await updater.check({ background: true })
    await updater.check()
    expect(onBackgroundAvailable).toHaveBeenCalledTimes(1)
    expect(onBackgroundAvailable).toHaveBeenCalledWith('0.2.0')
  })
})
