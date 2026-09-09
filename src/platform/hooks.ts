/**
 * React hooks over the typed IPC bridge.
 *
 *   const { data, error, loading, reload } = useInvoke('substrate:listSessions', { limit: 50 }, [])
 *   useBridgeEvent('agent:event', (e) => { ... })
 *
 * Both hooks resolve the bridge lazily via getBridge(), so they also work before bootstrap finished.
 */
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { EventChannel, EventMap, InvokeChannel, InvokeReq, InvokeRes } from '@aiwc/protocol'
import { getBridge } from './bridge'

export interface UseInvokeResult<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  /** Re-run the request (keeps the previous data while loading). */
  reload: () => void
}

export interface UseInvokeOptions {
  /** When false the request is not sent and `data` stays undefined (e.g. no session selected yet). */
  enabled?: boolean
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/** One-shot bridge call for event handlers and effects that do not need hook state. */
export function invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> {
  return getBridge().then((b) => b.invoke(channel, req))
}

export function useInvoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>, deps: DependencyList = [], options: UseInvokeOptions = {}): UseInvokeResult<InvokeRes<K>> {
  const enabled = options.enabled ?? true
  const [data, setData] = useState<InvokeRes<K> | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(req)
  reqRef.current = req

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getBridge()
      .then((b) => b.invoke(channel, reqRef.current))
      .then((res) => {
        if (cancelled) return
        setData(res)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(toError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channel, enabled, tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Subscribe to a push channel for the lifetime of the component; the handler may change freely. */
export function useBridgeEvent<K extends EventChannel>(channel: K, handler: (payload: EventMap[K]) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    let off: (() => void) | undefined
    let disposed = false
    getBridge().then((b) => {
      if (disposed) return
      off = b.on(channel, (payload) => handlerRef.current(payload))
    })
    return () => {
      disposed = true
      off?.()
    }
  }, [channel])
}
