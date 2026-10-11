/**
 * Read-only access to WeChat's own video folder for `aiwc-media://`. Chat videos (and their poster frames) are not
 * encrypted, so the substrate resolves them to `<account>/msg/video/<month>/<md5>.mp4` — outside the file
 * allow-list, which the media protocol shares with `file:*` (that list must never reach WeChat's folders: `file:*`
 * can write). This narrower rule only lets the media protocol READ video and poster files under the configured
 * account's `msg/video` directory, so a chat video streams in place (with Range) instead of being copied first.
 */
import { realpathSync } from 'node:fs'
import { extname, isAbsolute, relative, sep } from 'node:path'
import { isForbiddenRoot, isWithinRoot } from './pathAllowList'

/** What may be served from the video folder: the clips and their poster frames, nothing else. */
const VIDEO_FOLDER_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.mov', '.m4v', '.jpg', '.jpeg', '.png'])

/** True when `filePath` is a video or poster file under `<root>/…/msg/video/`. */
export function isWeChatVideoFile(filePath: string, root: string): boolean {
  if (!filePath || filePath.includes('\0') || !isAbsolute(filePath)) return false
  if (!VIDEO_FOLDER_EXTENSIONS.has(extname(filePath).toLowerCase())) return false
  if (isForbiddenRoot(root) || !isWithinRoot(filePath, root)) return false
  const parts = relative(root, filePath).split(sep)
  // `msg/video` must be a real pair of path segments below the root, with the file somewhere inside it.
  for (let i = 0; i + 2 < parts.length; i++) if (parts[i] === 'msg' && parts[i + 1] === 'video') return true
  return false
}

/**
 * The predicate the media protocol consults, for the account root configured now (settings › 账号). The root is
 * also compared in its resolved form, so the symlink-resolved path the protocol re-checks still matches.
 */
export function createWeChatVideoAccess(accountRoot: () => string | undefined): (filePath: string) => boolean {
  let cached: { root: string; real: string | undefined } | undefined
  const resolvedRoot = (root: string): string | undefined => {
    if (cached?.root !== root) {
      let real: string | undefined
      try {
        real = realpathSync(root)
      } catch {
        // the folder is gone (account moved): only the configured spelling can match, and nothing exists there
        real = undefined
      }
      cached = { root, real }
    }
    return cached.real
  }
  return (filePath) => {
    const root = accountRoot()
    if (!root) return false
    if (isWeChatVideoFile(filePath, root)) return true
    const real = resolvedRoot(root)
    return real !== undefined && real !== root && isWeChatVideoFile(filePath, real)
  }
}
