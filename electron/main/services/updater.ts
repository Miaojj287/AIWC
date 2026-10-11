/**
 * In-app updates over electron-updater (GitHub releases, as configured in package.json `build.publish`).
 * Only a packaged build that electron-builder gave an update feed (`resources/app-update.yml`) can
 * update; anywhere else the state says why (`unavailable`) and 检查更新 stays disabled — a stub must
 * never report "up to date". Flow: check (manual, or once in the background after launch) → available
 * → the user downloads → ready → installs now (quit and install) or on the next normal quit.
 * electron-updater is loaded lazily, and only when an update is possible.
 */
import type { UpdateState, UpdateStatus, UpdateUnavailableReason } from '@aiwc/protocol'

/** Delay before the background check after launch, so startup work goes first. */
export const BACKGROUND_CHECK_DELAY_MS = 60_000
/** A check that hangs (DNS, proxy) is reported as failed after this long. */
const CHECK_TIMEOUT_MS = 30_000

/** The part of electron-updater's AppUpdater this module uses. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update', cb: () => void): unknown
  on(
    event: 'update-available' | 'update-not-available' | 'update-downloaded',
    cb: (info: { version: string }) => void,
  ): unknown
  on(event: 'download-progress', cb: (p: { percent: number }) => void): unknown
  on(event: 'error', cb: (e: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdaterDeps {
  isPackaged: boolean
  platform: NodeJS.Platform
  /** Set by AppImage builds; other Linux packages cannot self-update. */
  appImage?: string
  /** Whether electron-builder wrote the feed file (`<resources>/app-update.yml`). */
  hasFeed: () => boolean
  appVersion: string
  load: () => Promise<AutoUpdaterLike>
  emit: (status: UpdateStatus) => void
  /** Background check found an update: tell the user once (a toast with a way to the 关于 page). */
  onBackgroundAvailable?: (version: string) => void
  logger: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  /** Localized "not possible in this build" error for the IPC layer. */
  unavailableError: (reason: UpdateUnavailableReason) => Error
  /** Localized error for download / install requested in the wrong state. */
  stateError: (what: 'download' | 'install') => Error
  timeoutError: () => Error
}

export interface Updater {
  state(): UpdateState
  check(opts?: { background?: boolean }): Promise<UpdateStatus>
  download(): Promise<void>
  install(): void
}

/** Why this build cannot update itself, or null when it can. */
export function updateUnavailableReason(
  deps: Pick<UpdaterDeps, 'isPackaged' | 'platform' | 'appImage' | 'hasFeed'>,
): UpdateUnavailableReason | null {
  if (!deps.isPackaged) return 'dev_build'
  if (deps.platform === 'linux' && !deps.appImage) return 'unsupported_platform'
  if (!deps.hasFeed()) return 'no_feed'
  return null
}

export function createUpdater(deps: UpdaterDeps): Updater {
  let status: UpdateStatus = { state: 'idle' }
  let updater: AutoUpdaterLike | undefined
  let background = false
  const unavailable = updateUnavailableReason(deps)

  const set = (next: UpdateStatus) => {
    status = next
    deps.emit(next)
  }

  async function ensure(): Promise<AutoUpdaterLike> {
    if (unavailable) throw deps.unavailableError(unavailable)
    if (updater) return updater
    const u = await deps.load()
    u.autoDownload = false
    u.autoInstallOnAppQuit = true
    u.on('checking-for-update', () => set({ state: 'checking' }))
    u.on('update-available', (info) => {
      set({ state: 'available', version: info.version })
      if (background) deps.onBackgroundAvailable?.(info.version)
    })
    u.on('update-not-available', () => set({ state: 'up_to_date', version: deps.appVersion }))
    u.on('download-progress', (p) =>
      set({ state: 'downloading', version: status.version, progress: Math.max(0, Math.min(1, p.percent / 100)) }),
    )
    u.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
    u.on('error', (e) => {
      deps.logger.warn('update failed', { message: e.message })
      set({ state: 'error', version: status.version, error: e.message })
    })
    updater = u
    return u
  }

  return {
    state: () => ({ status, unavailable }),

    async check(opts) {
      if (status.state === 'downloading' || status.state === 'ready') return status
      const u = await ensure()
      background = Boolean(opts?.background)
      set({ state: 'checking' })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          u.checkForUpdates(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(deps.timeoutError()), CHECK_TIMEOUT_MS)
          }),
        ])
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        set({ state: 'error', error: message })
      } finally {
        if (timer) clearTimeout(timer)
        background = false
      }
      // The events above have already moved the state; a check that resolved without any is up to date.
      if (status.state === 'checking') set({ state: 'up_to_date', version: deps.appVersion })
      return status
    },

    async download() {
      const u = await ensure()
      if (status.state !== 'available' && status.state !== 'error') throw deps.stateError('download')
      if (!status.version) throw deps.stateError('download')
      set({ state: 'downloading', version: status.version, progress: 0 })
      try {
        await u.downloadUpdate()
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        set({ state: 'error', version: status.version, error: message })
        throw e
      }
    },

    install() {
      if (!updater || status.state !== 'ready') throw deps.stateError('install')
      deps.logger.info('installing update', { version: status.version })
      updater.quitAndInstall()
    },
  }
}
