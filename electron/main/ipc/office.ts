/**
 * office:* — 飞书 / 钉钉 / 企业微信 connections for the settings page. The agent reaches the same
 * service through its tools; session progress is pushed on 'office:session' by the composition root.
 * Links are never taken from the renderer: office:openLink re-opens the URL the CLI printed.
 */
import { isOfficePlatform, type OfficePlatform } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

export function registerOfficeIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { office } = ctx
  const platform = (value: unknown): OfficePlatform => {
    if (!isOfficePlatform(value)) throw new Error(t('office.errors.unknownPlatform'))
    return value
  }
  handle('office:status', (req) => office.status({ refresh: req?.refresh === true }))
  handle(
    'office:connect',
    (req) => office.connect({ platform: platform(req.platform), reauthorize: req.reauthorize === true }).session,
  )
  handle('office:cancel', ({ sessionId }) => office.cancel(String(sessionId)))
  handle('office:openLink', ({ sessionId }) => office.openLink(String(sessionId)))
  handle('office:sessions', () => office.sessions())
  handle('office:disconnect', (req) => office.disconnect(platform(req.platform)))
  handle('office:pushes', (req) => office.recentPushes(Math.min(Math.max(Number(req?.limit) || 10, 1), 50)))
}
