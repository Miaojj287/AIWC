import { type HostedService, type PortLike, type RpcMethod, type RpcResponse, RPC_METHODS, attachPort, isRpcRequest } from './protocol'
import { isSubstrateError, errorMessage } from '../shared/errors'

const METHODS: ReadonlySet<string> = new Set(RPC_METHODS)

/**
 * Serve a SubstrateService over a port. Requests are dispatched by method name (allow-listed),
 * service events are forwarded as `{ event }`, and a `{ status }` snapshot follows every event so
 * the remote client's synchronous status() is always current. Returns a dispose function.
 */
export function serveSubstrate(service: HostedService, port: PortLike): () => void {
  const channel = attachPort(port)
  let disposed = false

  const safePost = (msg: unknown) => {
    if (disposed) return
    try {
      channel.post(msg)
    } catch {
      /* port closed */
    }
  }

  const pushStatus = () => safePost({ status: service.status() })

  const unsubscribe = service.subscribe((event) => {
    pushStatus()
    safePost({ event })
  })

  const handle = async (id: number, method: string, args: unknown[]) => {
    let response: RpcResponse
    try {
      if (!METHODS.has(method)) throw Object.assign(new Error(`未知方法：${method}`), { code: 'unsupported' })
      const fn = (service as unknown as Record<RpcMethod, ((...a: unknown[]) => unknown) | undefined>)[method as RpcMethod]
      if (typeof fn !== 'function') throw Object.assign(new Error(`当前数据源不支持：${method}`), { code: 'unsupported' })
      const result = await fn.apply(service, args)
      response = { id, ok: true, result: result === undefined ? null : result }
    } catch (err) {
      const code = isSubstrateError(err) ? err.code : (err as { code?: unknown } | null)?.code
      response = { id, ok: false, error: { message: errorMessage(err), code: typeof code === 'string' ? code : undefined } }
    }
    safePost(response)
    if (method === 'openWith' || method === 'close' || method === 'sync') pushStatus()
  }

  const off = channel.onMessage((msg) => {
    if (disposed || !isRpcRequest(msg)) return
    void handle(msg.id, msg.method, msg.args)
  })

  pushStatus()

  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    off()
  }
}
