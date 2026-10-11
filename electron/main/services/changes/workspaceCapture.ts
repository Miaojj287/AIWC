/**
 * Bounded before/after captures of the Agent workspace, so a `shell` command's file changes can be listed under its
 * turn and undone. Unlike the shell tool's own snapshot (previewable names + mtimes, for result cards), this one keeps
 * the bytes of small files: undoing a modification means writing the old bytes back. Bytes are cached by
 * (path, size, mtime), so a capture only re-reads files that changed since the last one.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Directory levels below the workspace root that are walked. */
export const CAPTURE_MAX_DEPTH = 4
/** Entries visited before a capture gives up (the result is then unusable and nothing is recorded). */
export const CAPTURE_MAX_ENTRIES = 4_000
/** Larger files are tracked by size + mtime only: their changes are listed but cannot be undone. */
export const CAPTURE_MAX_FILE_BYTES = 1_000_000
/** Bytes kept across all files of one capture. */
export const CAPTURE_MAX_TOTAL_BYTES = 16_000_000
/** Wall-clock budget for one capture. */
export const CAPTURE_MAX_MS = 400

const SKIPPED_DIRS = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv'])

export interface FileState {
  size: number
  mtimeMs: number
  /** sha256 of the bytes, or `size:mtime` when the file is too large to keep. */
  hash: string
  /** The bytes, when the file is small enough to restore. */
  content?: Buffer
}

/** Workspace-relative path (always `/`-separated) → state. */
export type Capture = ReadonlyMap<string, FileState>

export interface CaptureCache {
  get(path: string): FileState | undefined
  set(path: string, state: FileState): void
}

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

export function createCaptureCache(): CaptureCache & { prune(keep: ReadonlySet<string>): void } {
  const map = new Map<string, FileState>()
  return {
    get: (path) => map.get(path),
    set: (path, state) => void map.set(path, state),
    prune(keep) {
      for (const key of map.keys()) if (!keep.has(key)) map.delete(key)
    },
  }
}

/** Walk `root` within the bounds; undefined when a bound was hit (a partial capture would invent deletions). */
export function captureWorkspace(root: string, cache: CaptureCache, now: () => number = Date.now): Capture | undefined {
  const started = now()
  const files = new Map<string, FileState>()
  let visited = 0
  let keptBytes = 0
  const walk = (dir: string, depth: number): boolean => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // unreadable directory: its files are simply not tracked
      return true
    }
    for (const entry of entries) {
      if (++visited > CAPTURE_MAX_ENTRIES || now() - started > CAPTURE_MAX_MS) return false
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < CAPTURE_MAX_DEPTH && !SKIPPED_DIRS.has(entry.name) && !walk(path, depth + 1)) return false
        continue
      }
      if (!entry.isFile()) continue
      const state = stateOf(path, cache, CAPTURE_MAX_TOTAL_BYTES - keptBytes)
      if (!state) continue
      if (state.content) keptBytes += state.content.length
      files.set(relative(root, path).split(sep).join('/'), state)
    }
    return true
  }
  return walk(root, 0) ? files : undefined
}

function stateOf(path: string, cache: CaptureCache, budget: number): FileState | undefined {
  let st
  try {
    st = statSync(path)
  } catch {
    // removed between readdir and stat
    return undefined
  }
  const cached = cache.get(path)
  const unchanged = cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs
  if (unchanged && (!cached.content || cached.content.length <= budget)) return cached
  if (st.size > CAPTURE_MAX_FILE_BYTES || st.size > budget) {
    return { size: st.size, mtimeMs: st.mtimeMs, hash: `${st.size}:${st.mtimeMs}` }
  }
  try {
    const content = readFileSync(path)
    const state = { size: st.size, mtimeMs: st.mtimeMs, hash: sha256(content), content }
    cache.set(path, state)
    return state
  } catch {
    return { size: st.size, mtimeMs: st.mtimeMs, hash: `${st.size}:${st.mtimeMs}` }
  }
}

export interface FileDiff {
  path: string
  action: 'created' | 'modified' | 'deleted'
  before?: FileState
  after?: FileState
}

/** What a command changed: new files, files whose bytes changed, files that are gone. */
export function diffCaptures(before: Capture, after: Capture): FileDiff[] {
  const out: FileDiff[] = []
  for (const [path, state] of after) {
    const prev = before.get(path)
    if (!prev) out.push({ path, action: 'created', after: state })
    else if (prev.hash !== state.hash) out.push({ path, action: 'modified', before: prev, after: state })
  }
  for (const [path, state] of before) if (!after.has(path)) out.push({ path, action: 'deleted', before: state })
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
