export interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
  settled: boolean
}

export function deferred<T>(): Deferred<T> {
  const d = { settled: false } as Deferred<T>
  d.promise = new Promise<T>((res, rej) => {
    d.resolve = (v) => {
      d.settled = true
      res(v)
    }
    d.reject = (e) => {
      d.settled = true
      rej(e)
    }
  })
  return d
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
