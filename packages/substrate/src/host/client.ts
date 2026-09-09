import type { SubstrateEvent } from '@aiwc/protocol'
import {
  DEFAULT_TIMEOUT_MS,
  METHOD_TIMEOUTS,
  type HostedService,
  type RpcMethod,
  type ServiceStatus,
  type SubstrateExtras,
  isRpcEvent,
  isRpcResponse,
  isRpcStatus,
} from './protocol'
import { SubstrateError, type SubstrateErrorCode } from '../shared/errors'

export type SubstrateClient = HostedService &
  SubstrateExtras & {
    /** Stop listening; rejects all in-flight calls. */
    dispose(): void
    /** Ask the host for a fresh status snapshot (status() itself is served from cache). */
    refreshStatus(): Promise<ServiceStatus>
  }

export interface SubstrateClientOptions {
  /** Override the default per-call timeout (tests). Method-specific timeouts still apply when larger. */
  defaultTimeoutMs?: number
}

interface Pending {
  resolve(v: unknown): void
  reject(e: unknown): void
  timer: ReturnType<typeof setTimeout> | undefined
  method: string
}

const KNOWN_CODES: ReadonlySet<string> = new Set<SubstrateErrorCode>([
  'not_open', 'locked', 'invalid_key', 'not_found', 'unsupported', 'sql_rejected', 'timeout', 'rpc', 'fixture_invalid', 'io', 'cancelled', 'unknown',
])

/**
 * Proxy SubstrateService talking to serveSubstrate() on the other side of a port. `post` sends a
 * raw message; `onMessage` registers the raw receiver (both are provided by the caller so the
 * client is transport-agnostic).
 */
export function createSubstrateClient(
  post: (msg: unknown) => void,
  onMessage: (cb: (msg: unknown) => void) => void,
  options: SubstrateClientOptions = {},
): SubstrateClient {
  const baseTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  let nextId = 1
  let disposed = false
  const pending = new Map<number, Pending>()
  const listeners = new Set<(event: SubstrateEvent) => void>()
  let cached: ServiceStatus = { connection: 'no_config', sync: { phase: 'idle' } }

  onMessage((msg) => {
    if (disposed) return
    if (isRpcResponse(msg)) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (p.timer) clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg.result === null ? undefined : msg.result)
      else {
        const code = msg.error.code && KNOWN_CODES.has(msg.error.code) ? (msg.error.code as SubstrateErrorCode) : 'rpc'
        p.reject(new SubstrateError(code, msg.error.message))
      }
      return
    }
    if (isRpcStatus(msg)) {
      cached = msg.status
      return
    }
    if (isRpcEvent(msg)) {
      const event = msg.event
      if (event.type === 'connection') cached = { ...cached, connection: event.state }
      else if (event.type === 'sync') cached = { ...cached, sync: event.status }
      for (const l of listeners) {
        try {
          l(event)
        } catch {
          /* listener error must not break the channel */
        }
      }
    }
  })

  /** Explicit defaultTimeoutMs (tests) applies to every method; otherwise long-running methods get their own budget. */
  const timeoutFor = (method: RpcMethod): number => (options.defaultTimeoutMs !== undefined ? baseTimeout : METHOD_TIMEOUTS[method] ?? baseTimeout)

  const call = <T>(method: RpcMethod, args: unknown[], timeoutMs = timeoutFor(method)): Promise<T> => {
    if (disposed) return Promise.reject(new SubstrateError('rpc', '数据基座连接已关闭'))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            pending.delete(id)
            reject(new SubstrateError('timeout', `${method} 超时（${Math.round(timeoutMs / 1000)} 秒）`))
          }, timeoutMs)
        : undefined
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, method })
      try {
        post({ id, method, args })
      } catch (err) {
        pending.delete(id)
        if (timer) clearTimeout(timer)
        reject(new SubstrateError('rpc', `发送请求失败：${err instanceof Error ? err.message : String(err)}`))
      }
    })
  }

  const refreshStatus = async (): Promise<ServiceStatus> => {
    const s = await call<ServiceStatus>('status', [])
    cached = s
    return s
  }
  void refreshStatus().catch(() => {})

  const client: SubstrateClient = {
    status: () => cached,
    refreshStatus,
    listAccounts: () => call('listAccounts', []),
    getAccount: () => call('getAccount', []),
    listSessions: (q) => call('listSessions', [q]),
    getSession: (id) => call('getSession', [id]),
    listMessages: (q) => call('listMessages', [q]),
    getMessage: (sessionId, messageId) => call('getMessage', [sessionId, messageId]),
    getContext: (anchor, radius) => call('getContext', [anchor, radius]),
    search: (q) => call('search', [q]),
    listContacts: (q) => call('listContacts', [q]),
    getContact: (username) => call('getContact', [username]),
    listGroupMembers: (groupId, q) => call('listGroupMembers', q ? [groupId, q] : [groupId]),
    stats: (q) => call('stats', [q]),
    resolveMedia: (sessionId, messageId) => call('resolveMedia', [sessionId, messageId]),
    transcribeVoice: (sessionId, messageId, opts) => call('transcribeVoice', opts ? [sessionId, messageId, opts] : [sessionId, messageId]),
    sync: (opts) => call('sync', opts ? [opts] : []),
    querySql: (req) => call('querySql', [req]),
    openWith: (opts) => call('openWith', [opts]),
    close: () => call('close', []),
    setSessionFlags: (sessionId, flags) => call('setSessionFlags', [sessionId, flags]),
    removeIndex: (sessionId) => call('removeIndex', [sessionId]),
    rebuildIndex: (sessionId) => call('rebuildIndex', [sessionId]),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const [, p] of pending) {
        if (p.timer) clearTimeout(p.timer)
        p.reject(new SubstrateError('rpc', `数据基座连接已关闭（${p.method}）`))
      }
      pending.clear()
      listeners.clear()
    },
  }
  return client
}
