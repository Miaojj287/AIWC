import type { Event } from '@aiwc/protocol'

export interface Emitter {
  on(listener: (e: Event) => void): () => void
  emit(e: Event): void
}

/** Minimal synchronous fan-out. Listener errors are isolated so one bad UI subscriber cannot break a turn. */
export function createEmitter(onListenerError?: (err: unknown) => void): Emitter {
  const listeners = new Set<(e: Event) => void>()
  return {
    on(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(e) {
      for (const l of [...listeners]) {
        try {
          l(e)
        } catch (err) {
          onListenerError?.(err)
        }
      }
    },
  }
}
