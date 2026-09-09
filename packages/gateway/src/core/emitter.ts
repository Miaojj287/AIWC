/** Minimal typed listener list: listener errors are isolated so one bad subscriber cannot break a stream. */
export interface Emitter<T> {
  on(listener: (value: T) => void): () => void
  emit(value: T): void
  listenerCount(): number
}

export function createEmitter<T>(onError?: (err: unknown) => void): Emitter<T> {
  const listeners = new Set<(value: T) => void>()
  return {
    on(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value)
        } catch (err) {
          onError?.(err)
        }
      }
    },
    listenerCount: () => listeners.size,
  }
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : JSON.stringify(err)
}
