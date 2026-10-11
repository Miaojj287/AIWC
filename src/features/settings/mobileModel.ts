/**
 * 我的微信 settings: what the connection row shows for a status (badge, line under the title, which actions).
 * Pure — the section renders it, tests check it.
 */
import type { BadgeProps } from '@/kit'
import type { MessageKey } from '@/i18n'
import type { MobileSendKind, MobileStatus } from '@aiwc/protocol'

export interface MobileConnectionView {
  badge: { tone: NonNullable<BadgeProps['tone']>; label: MessageKey }
  /** Primary action of the row. */
  action: 'connect' | 'reconnect' | 'cancel' | 'manage'
  /** A QR code (or the wait for one) belongs under the row. */
  showQr: boolean
  /** Pushes and remote control can work: logged in as a known owner. */
  ready: boolean
}

export function connectionView(status: MobileStatus): MobileConnectionView {
  switch (status.state) {
    case 'connected':
      return status.ownerUnknown
        ? {
            badge: { tone: 'warn', label: 'mobile.settings.state.connected' },
            action: 'manage',
            showQr: false,
            ready: false,
          }
        : {
            badge: { tone: 'ok', label: 'mobile.settings.state.connected' },
            action: 'manage',
            showQr: false,
            ready: true,
          }
    case 'connecting':
      return status.scanned
        ? {
            badge: { tone: 'accent', label: 'mobile.settings.state.scanned' },
            action: 'cancel',
            showQr: false,
            ready: false,
          }
        : {
            badge: { tone: 'accent', label: 'mobile.settings.state.connecting' },
            action: 'cancel',
            showQr: true,
            ready: false,
          }
    case 'disconnected':
      return status.owner
        ? {
            badge: { tone: 'neutral', label: 'mobile.settings.state.disconnected' },
            action: 'reconnect',
            showQr: false,
            ready: false,
          }
        : {
            badge: { tone: 'neutral', label: 'mobile.settings.state.needsLogin' },
            action: 'connect',
            showQr: false,
            ready: false,
          }
    case 'error':
      return {
        badge: { tone: 'danger', label: 'mobile.settings.state.error' },
        action: status.owner ? 'reconnect' : 'connect',
        showQr: false,
        ready: false,
      }
    case 'needs_login':
      return {
        badge: { tone: 'neutral', label: 'mobile.settings.state.needsLogin' },
        action: 'connect',
        showQr: false,
        ready: false,
      }
  }
}

export const SEND_KIND_KEY: Record<MobileSendKind, MessageKey> = {
  task: 'mobile.settings.kinds.task',
  reply: 'mobile.settings.kinds.reply',
  approval: 'mobile.settings.kinds.approval',
  notice: 'mobile.settings.kinds.notice',
}
