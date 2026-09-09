/**
 * Small filesystem helpers shared by every store in this package:
 *  - atomic writes (tmp file in the same directory + fsync + rename)
 *  - a sidecar `.lock` file (exclusive create, stale after a timeout) plus an in-process keyed mutex
 *  - tolerant readers that return undefined instead of throwing on ENOENT
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'

export function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    if (isEnoent(e)) return undefined
    throw e
  }
}

export function readJsonIfExists<T>(path: string): T | undefined {
  const raw = readTextIfExists(path)
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch (e) {
    if (isEnoent(e)) return []
    throw e
  }
}

export function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort()
  } catch (e) {
    if (isEnoent(e)) return []
    throw e
  }
}

export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true })
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Write `content` to `path` atomically: readers always see the old or the new file, never a torn one. */
export function atomicWriteFile(path: string, content: string): void {
  ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, content, null, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, path)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw e
  }
}

export function appendFile(path: string, content: string): void {
  ensureDir(dirname(path))
  writeFileSync(path, content, { encoding: 'utf8', flag: 'a' })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface FileLockOptions {
  /** give up after this long (ms) */
  timeoutMs?: number
  /** a lock older than this is considered abandoned and is broken (ms) */
  staleMs?: number
}

/**
 * Cross-process sidecar lock: `${target}.lock` created with O_EXCL. The lock file holds the pid and
 * time so an operator can see who holds it; a lock older than `staleMs` is broken.
 */
export async function withFileLock<T>(target: string, fn: () => Promise<T> | T, opts: FileLockOptions = {}): Promise<T> {
  const lockPath = `${target}.lock`
  const timeoutMs = opts.timeoutMs ?? 5_000
  const staleMs = opts.staleMs ?? 10_000
  ensureDir(dirname(target))
  const startedAt = Date.now()
  for (;;) {
    let fd: number | undefined
    try {
      fd = openSync(lockPath, 'wx')
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`, null, 'utf8')
      break
    } catch (e) {
      if (fd !== undefined) closeSync(fd)
      if ((e as { code?: string }).code !== 'EEXIST') throw e
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > staleMs) {
          unlinkSync(lockPath)
          continue
        }
      } catch (statErr) {
        if (!isEnoent(statErr)) throw statErr
        continue
      }
      if (Date.now() - startedAt > timeoutMs) throw new Error(`lock timeout: ${lockPath}`)
      await sleep(15)
    }
  }
  try {
    closeSync(openSync(lockPath, 'r'))
  } catch {
    /* ignore */
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore */
    }
  }
}

/** In-process mutex keyed by string; serialises async sections that touch the same resource. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.tails.set(key, next.catch(() => undefined))
    void next.finally(() => {
      if (this.tails.get(key) === next) this.tails.delete(key)
    }).catch(() => undefined)
    return next
  }
}
