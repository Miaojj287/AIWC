/**
 * JSON-RPC 2.0 over an MCP transport: request / response matching with a timeout and cancellation
 * (`notifications/cancelled`), notifications both ways, and the two server → client requests a tools-only client
 * must answer (`ping`; everything else is "method not found"). Transports deliver parsed messages; this layer never
 * trusts their shape.
 */
import type { McpErrorCode } from '@aiwc/protocol'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

/** A failure with the stable code the settings page shows. */
export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'McpError'
  }
}

export interface McpTransport {
  start(): Promise<void>
  send(message: JsonRpcMessage): Promise<void>
  close(): Promise<void>
  /** Set by the session before start(). */
  onmessage?: (message: JsonRpcMessage) => void
  /** The transport ended (process exited, stream closed); `error` when it was not a deliberate close. */
  onclose?: (error?: McpError) => void
}

/** Narrow an unknown parsed value to a JSON-RPC message, or undefined. */
export function asJsonRpcMessage(value: unknown): JsonRpcMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (v.jsonrpc !== '2.0') return undefined
  if (typeof v.method === 'string') return v as unknown as JsonRpcMessage
  if ('id' in v && ('result' in v || 'error' in v)) return v as unknown as JsonRpcMessage
  return undefined
}

const isResponse = (m: JsonRpcMessage): m is JsonRpcResponse => !('method' in m)
const isRequest = (m: JsonRpcMessage): m is JsonRpcRequest => 'method' in m && 'id' in m && m.id !== undefined

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface RpcSession {
  request(method: string, params: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown>
  notify(method: string, params?: unknown): Promise<void>
  /** Server notifications (e.g. `notifications/tools/list_changed`). */
  onNotification?: (method: string, params: unknown) => void
  close(): Promise<void>
}

export function createRpcSession(transport: McpTransport, onClose: (error?: McpError) => void): RpcSession {
  const pending = new Map<number | string, Pending>()
  let nextId = 1
  let closed = false

  const failAll = (error: Error): void => {
    for (const [, p] of pending) p.reject(error)
    pending.clear()
  }

  const session: RpcSession = {
    async request(method, params, opts) {
      if (closed) throw new McpError('exited', 'connection closed')
      if (opts.signal?.aborted) throw new McpError('timeout', 'aborted')
      const id = nextId++
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      // Settled before it is awaited when the transport dies mid-send; the await below still sees it.
      result.catch(() => undefined)
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = (reason: string): void => {
        if (!pending.has(id)) return
        pending.get(id)?.reject(new McpError('timeout', reason))
        pending.delete(id)
        void transport
          .send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason } })
          .catch(() => undefined) // best effort: the server may already be gone
      }
      const onAbort = (): void => cancel('aborted')
      try {
        timer = setTimeout(() => cancel(`timed out after ${opts.timeoutMs}ms`), opts.timeoutMs)
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        await transport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
        return await result
      } catch (err) {
        pending.delete(id)
        throw err
      } finally {
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
      }
    },
    notify: (method, params) => transport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }),
    async close() {
      if (closed) return
      closed = true
      failAll(new McpError('exited', 'connection closed'))
      await transport.close()
    },
  }

  transport.onmessage = (message) => {
    if (isResponse(message)) {
      const entry = message.id === null ? undefined : pending.get(message.id)
      if (!entry || message.id === null) return
      pending.delete(message.id)
      if (message.error) entry.reject(new McpError('protocol', String(message.error.message ?? 'error')))
      else entry.resolve(message.result)
      return
    }
    if (isRequest(message)) {
      const reply: JsonRpcResponse =
        message.method === 'ping'
          ? { jsonrpc: '2.0', id: message.id, result: {} }
          : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
      void transport.send(reply).catch(() => undefined) // the server may have gone; the close path reports it
      return
    }
    session.onNotification?.(message.method, message.params)
  }
  transport.onclose = (error) => {
    if (closed) return
    closed = true
    failAll(error ?? new McpError('exited', 'connection closed'))
    onClose(error)
  }
  return session
}
