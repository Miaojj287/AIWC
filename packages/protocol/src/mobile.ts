/**
 * 我的微信 (the owner's own WeChat, reached through an iLink bot they log in with a QR code): task results pushed
 * to the phone, and the Agent driven from the phone. Outbound goes only to the WeChat account that scanned the
 * QR code (the owner, bound at login); inbound is accepted only from that account in a private chat.
 */
import { z } from 'zod'
import type { AdapterState } from './gateway'

/**
 * Permission mode of the phone's Agent thread. Autopilot is not offered: nothing may send outward on the owner's
 * behalf without a confirmation they can see, and the mode can only be changed on the computer.
 */
export const MobileRemoteModeSchema = z.enum(['ask', 'bypass'])
export type MobileRemoteMode = z.infer<typeof MobileRemoteModeSchema>

/** `mobile:setRemote` request: everything the renderer may change about remote control. */
export const MobileRemoteSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  permissionMode: MobileRemoteModeSchema,
})
export type MobileRemoteSettings = z.infer<typeof MobileRemoteSettingsSchema>

/** What an outbound message to the owner was: drives the audit log and the settings page's "last push". */
export type MobileSendKind = 'task' | 'reply' | 'approval' | 'notice'

/** One audited outbound message to the owner. No message text is kept, only its size. */
export interface MobileSendRecord {
  at: number
  kind: MobileSendKind
  ok: boolean
  /** Stable reason or the channel's own error text. */
  error?: string
  chars: number
  taskId?: string
  threadId?: string
}

export interface MobileStatus {
  state: AdapterState
  /** While logging in: the QR code to scan (data URL), absent once scanned. */
  qrDataUrl?: string
  /** True after the code was scanned and the phone has to confirm. */
  scanned: boolean
  /** Adapter detail (already in the UI language), e.g. why the connection dropped. */
  detail?: string
  /** The bound owner, masked for display; absent when not logged in. */
  owner?: string
  /** Logged in, but the login response did not say which WeChat account scanned it: nothing can be sent or accepted. */
  ownerUnknown: boolean
  /** The login survives a restart (false when the OS keychain is unavailable). */
  persisted: boolean
  remote: MobileRemoteSettings & {
    /** The phone's Agent thread, when one exists. */
    threadId?: string
    running: boolean
    pendingApprovals: number
  }
  lastSend?: MobileSendRecord
}
