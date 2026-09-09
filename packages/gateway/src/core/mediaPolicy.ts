/**
 * Outbound media allow-list. A local file may leave this machine through a WeChat channel only when
 * its *real* path lives under one of the configured roots (media cache / exports / user-picked dirs).
 * Symlinks are resolved on both sides before comparing, so a link placed inside a root that points at
 * ~/.ssh, a `..` segment, or macOS's `/tmp → /private/tmp` indirection cannot slip past the check.
 *
 * Used twice on purpose (defence in depth): by the `send_media` tool before it asks the gateway to
 * send, and by the iLink adapter right before it reads the file for upload.
 */
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Static list or a getter (the composition root's allow-list can grow while the app runs). */
export type MediaRoots = readonly string[] | (() => readonly string[])

export type MediaPolicyVerdict = { ok: true; path: string } | { ok: false; error: string }

export const MEDIA_ROOTS_MISSING_ERROR = '未配置允许发送的本机目录，已拒绝发送文件'
export const MEDIA_PATH_NOT_ABSOLUTE_ERROR = '媒体路径必须是绝对路径'

export function resolveMediaRoots(roots: MediaRoots | undefined): string[] {
  const list = typeof roots === 'function' ? roots() : roots
  if (!list) return []
  return list.filter((r): r is string => typeof r === 'string' && r.length > 0 && !r.includes('\0'))
}

function normalise(p: string): string {
  const r = resolve(p)
  return r.length > 1 && r.endsWith(sep) ? r.slice(0, -1) : r
}

/**
 * realpath of the path (defeats symlink escapes). For a path that does not exist yet the deepest
 * existing ancestor is resolved and the missing tail re-appended, so files under a symlinked root
 * (macOS `/tmp`) compare equal to the root whether or not they exist.
 */
export function canonicalPath(filePath: string): string {
  const abs = normalise(filePath)
  let probe = abs
  const tail: string[] = []
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return abs
    tail.unshift(basename(probe))
    probe = parent
  }
  try {
    return normalise(join(realpathSync(probe), ...tail))
  } catch {
    return abs
  }
}

export function isWithinRoot(filePath: string, root: string): boolean {
  const abs = normalise(filePath)
  const base = normalise(root)
  if (abs === base) return true
  const rel = relative(base, abs)
  if (!rel) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Plain containment check (no filesystem access); callers wanting symlink safety canonicalise first. */
export function isWithinRoots(filePath: string, roots: readonly string[]): boolean {
  if (!filePath || typeof filePath !== 'string') return false
  if (filePath.includes('\0')) return false
  return roots.some((root) => isWithinRoot(filePath, root))
}

/**
 * Decide whether `filePath` may be sent. Returns the canonical path to hand to the adapter on success
 * and a user-facing (Chinese) reason on failure. The reason never echoes the full path: in a bot thread
 * the model may relay tool errors to the remote contact.
 */
export function checkOutboundMedia(filePath: string, roots: MediaRoots | undefined): MediaPolicyVerdict {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0') || !isAbsolute(filePath)) {
    return { ok: false, error: MEDIA_PATH_NOT_ABSOLUTE_ERROR }
  }
  const allowed = resolveMediaRoots(roots)
  if (allowed.length === 0) return { ok: false, error: MEDIA_ROOTS_MISSING_ERROR }
  const canonical = canonicalPath(filePath)
  const canonicalRoots = allowed.map(canonicalPath)
  if (!isWithinRoots(canonical, canonicalRoots)) {
    return { ok: false, error: `文件不在允许发送的目录内：${basename(filePath)}` }
  }
  return { ok: true, path: canonical }
}
