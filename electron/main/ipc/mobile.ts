/**
 * mobile:* — 我的微信. Thin: validate → service → status. The remote-control settings are checked with the
 * protocol schema at runtime (the renderer is untrusted): Autopilot or any unknown field is refused here.
 */
import { MobileRemoteSettingsSchema } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

/** Most audit records the settings page may ask for at once. */
const SENDS_MAX_LIMIT = 50

export function registerMobileIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { mobile } = ctx
  handle('mobile:status', () => mobile.status())
  handle('mobile:connect', () => mobile.connect())
  handle('mobile:cancelLogin', () => mobile.cancelLogin())
  handle('mobile:disconnect', () => mobile.disconnect())
  handle('mobile:setRemote', (req) => {
    const parsed = MobileRemoteSettingsSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('mobile.errors.invalidRequest'))
    return mobile.setRemote(parsed.data)
  })
  handle('mobile:test', () => mobile.test())
  handle('mobile:sends', (req) => {
    const raw = req?.limit
    const limit = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 10
    return mobile.sends(Math.max(1, Math.min(SENDS_MAX_LIMIT, limit)))
  })
}
