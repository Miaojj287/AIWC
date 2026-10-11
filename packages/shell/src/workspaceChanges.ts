/**
 * Files a shell command produced in the workspace, so the Agent's reply can offer them as result cards. The command
 * line says nothing reliable about what it writes (`python make_report.py`), so the tool snapshots the workspace
 * (names, sizes, mtimes — never contents) before and after the run and reports what is new or changed. The walk is
 * bounded in depth, entries and time; a workspace too big to snapshot simply yields no cards.
 */
import { readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ToolArtifact } from '@aiwc/protocol'

/** Directory levels below the workspace root that are looked at. */
export const SNAPSHOT_MAX_DEPTH = 4
/** Entries (files and directories) visited before the snapshot gives up. */
export const SNAPSHOT_MAX_ENTRIES = 4_000
/** Wall-clock budget for one snapshot. */
export const SNAPSHOT_MAX_MS = 150
/** Cards one command may add to the transcript. */
export const MAX_ARTIFACTS_PER_CALL = 5

/** What the workspace tab can show (or hand to the system app); other files are build output and noise. */
const PREVIEWABLE: Readonly<Record<string, { kind: ToolArtifact['kind']; mediaType: string }>> = {
  '.md': { kind: 'file', mediaType: 'text/markdown' },
  '.markdown': { kind: 'file', mediaType: 'text/markdown' },
  '.txt': { kind: 'file', mediaType: 'text/plain' },
  '.csv': { kind: 'file', mediaType: 'text/csv' },
  '.tsv': { kind: 'file', mediaType: 'text/tab-separated-values' },
  '.json': { kind: 'file', mediaType: 'application/json' },
  '.html': { kind: 'file', mediaType: 'text/html' },
  '.pdf': { kind: 'file', mediaType: 'application/pdf' },
  '.xlsx': { kind: 'file', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.docx': { kind: 'file', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.pptx': { kind: 'file', mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.png': { kind: 'image', mediaType: 'image/png' },
  '.jpg': { kind: 'image', mediaType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mediaType: 'image/jpeg' },
  '.gif': { kind: 'image', mediaType: 'image/gif' },
  '.webp': { kind: 'image', mediaType: 'image/webp' },
  '.svg': { kind: 'image', mediaType: 'image/svg+xml' },
}

/** Directories that hold tooling state, not results. */
const SKIPPED_DIRS = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv'])

/** Office lock files, editor swap / backup files and temp files are never results. */
const isNoise = (name: string): boolean =>
  name.startsWith('.') || name.startsWith('~$') || name.endsWith('~') || /\.(tmp|swp|part|crdownload)$/i.test(name)

/** path → `${size}:${mtimeMs}` for every previewable file; undefined when the walk ran out of budget. */
export type WorkspaceSnapshot = ReadonlyMap<string, string>

export function snapshotWorkspace(root: string, now: () => number = Date.now): WorkspaceSnapshot | undefined {
  const started = now()
  const files = new Map<string, string>()
  let visited = 0
  const walk = (dir: string, depth: number): boolean => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // unreadable directory: skip it, the rest of the snapshot is still valid
      return true
    }
    for (const entry of entries) {
      if (++visited > SNAPSHOT_MAX_ENTRIES || now() - started > SNAPSHOT_MAX_MS) return false
      if (isNoise(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < SNAPSHOT_MAX_DEPTH && !SKIPPED_DIRS.has(entry.name) && !walk(path, depth + 1)) return false
        continue
      }
      if (!entry.isFile() || !PREVIEWABLE[extname(entry.name).toLowerCase()]) continue
      try {
        const st = statSync(path)
        files.set(path, `${st.size}:${st.mtimeMs}`)
      } catch {
        // removed between readdir and stat
      }
    }
    return true
  }
  return walk(root, 0) ? files : undefined
}

/** New or changed previewable files, most recently listed last, at most MAX_ARTIFACTS_PER_CALL. */
export function changedFiles(
  before: WorkspaceSnapshot | undefined,
  after: WorkspaceSnapshot | undefined,
): ToolArtifact[] {
  if (!before || !after) return []
  const out: ToolArtifact[] = []
  for (const [path, signature] of after) {
    if (before.get(path) === signature) continue
    const kind = PREVIEWABLE[extname(path).toLowerCase()]
    if (kind) out.push({ kind: kind.kind, title: basename(path), path, mediaType: kind.mediaType })
  }
  return out.slice(-MAX_ARTIFACTS_PER_CALL)
}
