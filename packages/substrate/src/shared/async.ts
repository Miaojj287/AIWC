import { SubstrateError } from './errors'

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel(): void
  flush(): void
  readonly pending: boolean
}

/**
 * Trailing-edge debounce that MERGES arguments through `merge` so no call is dropped
 * (used to coalesce source.watch() change notifications into one incremental sync).
 */
export function debounce<A extends unknown[], S>(
  waitMs: number,
  merge: (state: S | undefined, ...args: A) => S,
  fire: (state: S) => void,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: S | undefined
  const run = () => {
    timer = undefined
    if (state === undefined) return
    const s = state
    state = undefined
    fire(s)
  }
  const fn = ((...args: A) => {
    state = merge(state, ...args)
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, waitMs)
  }) as Debounced<A>
  fn.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    state = undefined
  }
  fn.flush = () => {
    if (timer) clearTimeout(timer)
    run()
  }
  Object.defineProperty(fn, 'pending', { get: () => timer !== undefined })
  return fn
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reject after `ms` with a SubstrateError('timeout'). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SubstrateError('timeout', `${label} 超时（${Math.round(ms / 1000)} 秒）`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

/** Split an array into fixed-size batches. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  const n = Math.max(1, Math.floor(size))
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}
