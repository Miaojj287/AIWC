/**
 * Fair-ish read/write lock: shared holders run concurrently, exclusive holders run alone, requests are
 * served in FIFO order so a burst of parallel-safe reads cannot starve an exclusive write behind them.
 */
export interface RwLock {
  /** Resolves with this hold's release; calling the release again is a no-op. */
  acquire(mode: 'shared' | 'exclusive'): Promise<() => void>
}

interface Waiter {
  mode: 'shared' | 'exclusive'
  resolve: (release: () => void) => void
}

/**
 * Wraps a release so only its first call counts. Callers release from several exits (finally blocks, abandon
 * paths); a second call would otherwise free a hold it no longer owns — a negative reader count, or clearing
 * the writer flag while the next exclusive holder is running.
 */
function releaseOnce(release: () => void): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    release()
  }
}

export function createRwLock(): RwLock {
  let readers = 0
  let writer = false
  const queue: Waiter[] = []

  const pump = (): void => {
    while (queue.length > 0) {
      const head = queue[0]!
      if (head.mode === 'exclusive') {
        if (readers > 0 || writer) return
        queue.shift()
        writer = true
        head.resolve(
          releaseOnce(() => {
            writer = false
            pump()
          }),
        )
        return
      }
      if (writer) return
      queue.shift()
      readers++
      head.resolve(
        releaseOnce(() => {
          readers--
          pump()
        }),
      )
    }
  }

  return {
    acquire(mode) {
      return new Promise((resolve) => {
        queue.push({ mode, resolve })
        pump()
      })
    },
  }
}
