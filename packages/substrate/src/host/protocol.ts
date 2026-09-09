/**
 * Minimal JSON-RPC over a MessagePort-like channel. Shapes are deliberately tiny and structural
 * (no class instances) so they cross Electron MessagePortMain / worker MessagePort / a fake pair
 * in tests unchanged.
 */
import type { SubstrateEvent, SubstrateService, WxAccount, ConnectionState, SyncStatus } from '@aiwc/protocol'
import type { SourceOpenOptions } from '../source'

export interface RpcRequest {
  id: number
  method: string
  args: unknown[]
}

export interface RpcError {
  message: string
  code?: string
}

export type RpcResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: RpcError }

export interface RpcEvent {
  event: SubstrateEvent
}

export type ServiceStatus = { connection: ConnectionState; sync: SyncStatus; account?: WxAccount }

/** Pushed by the server after every event so the client's synchronous status() stays fresh. */
export interface RpcStatus {
  status: ServiceStatus
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent | RpcStatus

export const DEFAULT_TIMEOUT_MS = 60_000
export const SYNC_TIMEOUT_MS = 10 * 60_000
export const OPEN_TIMEOUT_MS = 5 * 60_000

/** Methods a client may invoke over the wire (subscribe is local; events are pushed). */
export const RPC_METHODS = [
  'status',
  'listAccounts',
  'getAccount',
  'listSessions',
  'getSession',
  'listMessages',
  'getMessage',
  'getContext',
  'search',
  'listContacts',
  'getContact',
  'listGroupMembers',
  'stats',
  'resolveMedia',
  'transcribeVoice',
  'sync',
  'querySql',
  'openWith',
  'close',
  'setSessionFlags',
  'removeIndex',
  'rebuildIndex',
] as const

export type RpcMethod = (typeof RPC_METHODS)[number]

export const METHOD_TIMEOUTS: Partial<Record<RpcMethod, number>> = {
  sync: SYNC_TIMEOUT_MS,
  openWith: OPEN_TIMEOUT_MS,
  transcribeVoice: SYNC_TIMEOUT_MS,
  rebuildIndex: SYNC_TIMEOUT_MS,
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function isRpcRequest(v: unknown): v is RpcRequest {
  return isObject(v) && typeof v.id === 'number' && typeof v.method === 'string' && Array.isArray(v.args)
}

export function isRpcResponse(v: unknown): v is RpcResponse {
  return isObject(v) && typeof v.id === 'number' && typeof v.ok === 'boolean' && !('method' in v)
}

export function isRpcEvent(v: unknown): v is RpcEvent {
  return isObject(v) && isObject(v.event) && typeof (v.event as { type?: unknown }).type === 'string'
}

export function isRpcStatus(v: unknown): v is RpcStatus {
  return isObject(v) && isObject(v.status) && typeof (v.status as { connection?: unknown }).connection === 'string'
}

/** Local-index operations exposed by the facade beyond SubstrateService (backing substrate:setSessionFlags / removeIndex / rebuildIndex). */
export interface SubstrateExtras {
  setSessionFlags(sessionId: string, flags: { pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }): Promise<void>
  removeIndex(sessionId: string): Promise<void>
  rebuildIndex(sessionId: string): Promise<void>
}

export type HostedService = SubstrateService & {
  openWith(opts: SourceOpenOptions): Promise<void>
  close(): Promise<void>
} & Partial<SubstrateExtras>

/**
 * Duck-typed port: Electron MessagePortMain (.on/.postMessage/.start), node worker MessagePort
 * (.on or .addEventListener, .start), web MessagePort (.onmessage/.addEventListener), or a fake.
 */
export interface PortLike {
  postMessage(message: unknown): void
  start?(): void
  close?(): void
  on?(event: 'message', listener: (ev: unknown) => void): unknown
  off?(event: 'message', listener: (ev: unknown) => void): unknown
  removeListener?(event: 'message', listener: (ev: unknown) => void): unknown
  addEventListener?(type: 'message', listener: (ev: unknown) => void): unknown
  removeEventListener?(type: 'message', listener: (ev: unknown) => void): unknown
  onmessage?: ((ev: unknown) => void) | null
}

/** Unwrap MessageEvent-shaped envelopes ({ data }) into the payload. */
export function unwrapPortMessage(ev: unknown): unknown {
  if (isObject(ev) && 'data' in ev && !('method' in ev) && !('ok' in ev) && !('event' in ev) && !('status' in ev)) return ev.data
  return ev
}

/** Normalise any PortLike into post/onMessage. */
export function attachPort(port: PortLike): { post(msg: unknown): void; onMessage(cb: (msg: unknown) => void): () => void; close(): void } {
  return {
    post: (msg) => port.postMessage(msg),
    onMessage: (cb) => {
      const listener = (ev: unknown) => cb(unwrapPortMessage(ev))
      if (typeof port.on === 'function') {
        port.on('message', listener)
        port.start?.()
        return () => {
          if (typeof port.off === 'function') port.off('message', listener)
          else port.removeListener?.('message', listener)
        }
      }
      if (typeof port.addEventListener === 'function') {
        port.addEventListener('message', listener)
        port.start?.()
        return () => port.removeEventListener?.('message', listener)
      }
      const prev = port.onmessage ?? null
      port.onmessage = listener
      port.start?.()
      return () => {
        if (port.onmessage === listener) port.onmessage = prev
      }
    },
    close: () => port.close?.(),
  }
}
