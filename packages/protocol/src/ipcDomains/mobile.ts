/**
 * IPC channels for the owner's own WeChat (push to phone, remote control). Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type { MobileRemoteSettings, MobileSendRecord, MobileStatus } from '../mobile'

/** Invoke channels (the owner's own WeChat (push to phone, remote control)). */
export interface MobileInvokeMap {
  'mobile:status': { req: void; res: MobileStatus }
  /** Start the QR login in the background; progress arrives as 'mobile:changed' pushes. */
  'mobile:connect': { req: void; res: MobileStatus }
  'mobile:cancelLogin': { req: void; res: MobileStatus }
  /** Log out and forget the login (the UI confirms first). */
  'mobile:disconnect': { req: void; res: MobileStatus }
  'mobile:setRemote': { req: MobileRemoteSettings; res: MobileStatus }
  /** Send a short test message to the owner. */
  'mobile:test': { req: void; res: MobileSendRecord }
  /** Latest audited outbound messages, newest first. */
  'mobile:sends': { req: { limit?: number } | void; res: MobileSendRecord[] }
}

/** Push events (the owner's own WeChat (push to phone, remote control)). */
export interface MobileEventMap {
  'mobile:changed': MobileStatus
}

export const MOBILE_INVOKE_CHANNELS = [
  'mobile:status',
  'mobile:connect',
  'mobile:cancelLogin',
  'mobile:disconnect',
  'mobile:setRemote',
  'mobile:test',
  'mobile:sends',
] as const satisfies readonly (keyof MobileInvokeMap)[]
export const MOBILE_EVENT_CHANNELS = ['mobile:changed'] as const satisfies readonly (keyof MobileEventMap)[]
