/**
 * Fair-ish read/write lock: shared holders run concurrently, exclusive holders run alone, requests are
 * served in FIFO order so a burst of parallel-safe reads cannot starve an exclusive write behind them.
 */
export interface RwLock {
  acquire(mode: 'shared' | 'exclusive'): Promise<() => void>
}

interface Waiter {
  mode: 'shared' | 'exclusive'
  resolve: (release: () => void) => void
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
        head.resolve(() => {
          writer = false
          pump()
        })
        return
      }
      if (writer) return
      queue.shift()
      readers++
      head.resolve(() => {
        readers--
        pump()
      })
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
