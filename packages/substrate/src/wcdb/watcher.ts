/**
 * Debounced fs.watch over WeChat's db_storage subdirectories. WeChat writes through WAL, so we watch
 * directories (not files) and react to `.db`, `-wal` and `-shm` changes.
 */
import { watch, type FSWatcher } from 'node:fs'

export interface DbWatcherOptions {
  debounceMs?: number
  /** Called with the file names seen in the debounce window (basename only). */
  onChange: (changedFiles: string[]) => void
  onError?: (error: Error) => void
}

const RELEVANT = /(\.db|\.db-wal|\.db-shm)$/i

export function isRelevantDbFile(fileName: string | null | undefined): boolean {
  if (!fileName) return true // unknown filename: assume relevant
  return RELEVANT.test(fileName)
}

/** Generic debouncer collecting changed names; exported for tests. */
export function createDebouncedCollector(debounceMs: number, flush: (items: string[]) => void, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }) {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    push(item: string) {
      pending.add(item)
      if (timer) return // Bound latency even while WAL writes continue.
      timer = timers.set(() => {
        timer = undefined
        const items = Array.from(pending)
        pending.clear()
        flush(items)
      }, debounceMs)
    },
    cancel() {
      if (timer) timers.clear(timer)
      timer = undefined
      pending.clear()
    },
  }
}

/** Start watching; returns a disposer. */
export function watchDbDirs(dirs: string[], opts: DbWatcherOptions): () => void {
  const debounceMs = opts.debounceMs ?? 250
  const collector = createDebouncedCollector(debounceMs, opts.onChange)
  const watchers: FSWatcher[] = []
  for (const dir of dirs) {
    try {
      const watcher = watch(dir, { persistent: false }, (_event, fileName) => {
        const name = fileName ? String(fileName) : ''
        if (!isRelevantDbFile(name)) return
        collector.push(name || '*')
      })
      watcher.on('error', (error) => opts.onError?.(error instanceof Error ? error : new Error(String(error))))
      watchers.push(watcher)
    } catch (error) {
      opts.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return () => {
    collector.cancel()
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // already closed
      }
    }
    watchers.length = 0
  }
}
