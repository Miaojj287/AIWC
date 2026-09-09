/**
 * Path allow-list shared by the `aiwc-media://` protocol handler and the `file:*` IPC handlers.
 * A path is allowed only when its normalised absolute form lives under one of the roots. The
 * caller additionally resolves symlinks (realpath) before checking, so `..` and link tricks fail.
 */
import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export interface AllowList {
  roots(): string[]
  /**
   * Add a root for the rest of the session. Only trusted main-side sources may call this (the
   * directory-picker result, validated startup config) — never a value the renderer sent. Returns
   * false (and adds nothing) for a filesystem root or the user's home directory.
   */
  addRoot(dir: string): boolean
  isAllowed(filePath: string): boolean
}

export interface AllowListOptions {
  /** Injected for tests; defaults to os.homedir(). */
  home?: string
}

function normalise(p: string): string {
  // strip a trailing separator so `relative()` treats root and file the same way
  const r = resolve(p)
  return r.length > 1 && r.endsWith(sep) ? r.slice(0, -1) : r
}

/**
 * A root that would whitelist (almost) the whole disk: '/' (or 'C:\\') and the home directory.
 * Allowing either defeats the purpose of the allow-list, so they are refused everywhere.
 */
export function isForbiddenRoot(dir: string, home: string = homedir()): boolean {
  if (!dir || typeof dir !== 'string' || dir.includes('\0')) return true
  const abs = normalise(dir)
  const { root } = parse(abs)
  if (normalise(root) === abs) return true
  return normalise(home) === abs
}

export function isWithinRoot(filePath: string, root: string): boolean {
  const abs = normalise(filePath)
  const base = normalise(root)
  if (abs === base) return true
  const rel = relative(base, abs)
  if (!rel || rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function isWithinRoots(filePath: string, roots: readonly string[]): boolean {
  if (!filePath || typeof filePath !== 'string') return false
  if (filePath.includes('\0')) return false
  return roots.some((root) => isWithinRoot(filePath, root))
}

export function createAllowList(initial: readonly string[], opts: AllowListOptions = {}): AllowList {
  const home = opts.home ?? homedir()
  const roots = new Set<string>()
  const add = (dir: string): boolean => {
    if (!dir || isForbiddenRoot(dir, home)) return false
    roots.add(normalise(dir))
    return true
  }
  for (const dir of initial) add(dir)
  return {
    roots: () => [...roots],
    addRoot: add,
    isAllowed: (filePath) => isWithinRoots(filePath, [...roots]),
  }
}

// ---- symlink-aware resolution (shared by app:openPath, file:* and the media protocol) -------------

/** The two fs calls the resolvers need; injectable for tests. */
export interface AllowListFs {
  realpath(p: string): Promise<string>
  lstat(p: string): Promise<{ isSymbolicLink(): boolean }>
}
const nodeFs: AllowListFs = { realpath, lstat }

export const PATH_DENIED_MESSAGE = '该路径不在允许访问的目录内'
export const PATH_NOT_FOUND_MESSAGE = '文件不存在'
export const PATH_SYMLINK_MESSAGE = '目标是符号链接，拒绝写入'

const denied = (): Error => new Error(PATH_DENIED_MESSAGE)
const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

/**
 * Resolve an existing path's symlinks and require BOTH the requested and the real path to be inside
 * the allow-list. Use for every read-style access (open, reveal, read, media).
 */
export async function resolveAllowedExisting(allowList: Pick<AllowList, 'isAllowed'>, filePath: string, fs: AllowListFs = nodeFs): Promise<string> {
  if (!allowList.isAllowed(filePath)) throw denied()
  let real: string
  try {
    real = await fs.realpath(filePath)
  } catch (e) {
    if (isEnoent(e)) throw new Error(PATH_NOT_FOUND_MESSAGE)
    throw e
  }
  if (!allowList.isAllowed(real)) throw denied()
  return real
}

/**
 * Resolve a write target. Refuses when the target itself is a symlink (writing through it would land
 * wherever the link points, even inside the allow-list) or when the real path of its deepest existing
 * ancestor leaves the allow-list. Returns the path to actually write (real ancestor + remainder).
 */
export async function resolveAllowedWriteTarget(allowList: Pick<AllowList, 'isAllowed'>, filePath: string, fs: AllowListFs = nodeFs): Promise<string> {
  if (!allowList.isAllowed(filePath)) throw denied()
  const abs = normalise(filePath)
  try {
    if ((await fs.lstat(abs)).isSymbolicLink()) throw new Error(PATH_SYMLINK_MESSAGE)
    const real = await fs.realpath(abs)
    if (!allowList.isAllowed(real)) throw denied()
    return real
  } catch (e) {
    if (!isEnoent(e)) throw e
  }
  // Target does not exist: walk up to the deepest existing ancestor and resolve that.
  const missing: string[] = []
  let dir = abs
  for (;;) {
    const parent = dirname(dir)
    if (parent === dir) throw denied()
    missing.unshift(dir.slice(parent.length + 1))
    dir = parent
    try {
      const realDir = await fs.realpath(dir)
      if (!allowList.isAllowed(realDir)) throw denied()
      return join(realDir, ...missing)
    } catch (e) {
      if (!isEnoent(e)) throw e
    }
  }
}

/**
 * Parse `aiwc-media://…` into an absolute file path.
 *   aiwc-media:///Users/me/x.jpg         → /Users/me/x.jpg
 *   aiwc-media:///C:/Users/me/x.jpg      → C:/Users/me/x.jpg  (win32)
 *   aiwc-media://media/<percent-encoded absolute path>  (alternate host form)
 * Returns null for anything that does not decode to an absolute path.
 */
export function parseMediaUrl(url: string, platform: NodeJS.Platform = process.platform): string | null {
  const prefix = 'aiwc-media://'
  if (!url.startsWith(prefix)) return null
  let rest = url.slice(prefix.length)
  const q = rest.search(/[?#]/)
  if (q >= 0) rest = rest.slice(0, q)
  if (rest.startsWith('media/')) rest = rest.slice('media/'.length)
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (platform === 'win32') {
    // "/C:/x" → "C:/x"
    if (/^\/[A-Za-z]:[\\/]/.test(decoded)) decoded = decoded.slice(1)
    if (!/^[A-Za-z]:[\\/]/.test(decoded)) return null
    return decoded.replace(/\//g, '\\')
  }
  if (!decoded.startsWith('/')) decoded = `/${decoded}`
  return decoded
}

/** Build an `aiwc-media://` URL for an absolute local path (what the renderer should use in <img>). */
export function toMediaUrl(absPath: string): string {
  const posix = absPath.replace(/\\/g, '/')
  const withSlash = posix.startsWith('/') ? posix : `/${posix}`
  return `aiwc-media://${withSlash.split('/').map(encodeURIComponent).join('/')}`
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.silk': 'application/octet-stream',
  '.amr': 'audio/amr',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
}

export function mediaTypeFor(filePath: string): string {
  const m = /\.[A-Za-z0-9]+$/.exec(filePath)
  const ext = m ? m[0].toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}

export const TEXT_MEDIA_PREFIXES = ['text/', 'application/json']
export const isTextMediaType = (mt: string): boolean => TEXT_MEDIA_PREFIXES.some((p) => mt.startsWith(p))
