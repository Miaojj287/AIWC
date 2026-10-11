/**
 * Chat attachments for in-app preview. A WeChat file message's attachment lives in WeChat's own folder,
 * which is outside the file allow-list (and stays that way: the renderer must never be able to read
 * arbitrary WeChat files). Previewing therefore copies that one attachment — located by the substrate
 * from the message, never by a path the renderer sent — into `<cache>/previews/<message hash>/`, which
 * the allow-list already covers. The WeChat folder is only read.
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { WxMedia } from '@aiwc/protocol'
import { isForbiddenRoot, isWithinRoot } from '../security/pathAllowList'
import { t } from '../i18n'

/** Largest attachment copied for preview (a copy-on-write clone on APFS; a real copy elsewhere). */
export const MAX_STAGE_BYTES = 2 * 1024 * 1024 * 1024
/** Folder under the app cache that holds staged attachments (cleared with the media cache). */
export const PREVIEW_STAGE_DIR_NAME = 'previews'
/** Longest file name kept; longer names keep their extension. */
const MAX_NAME_CHARS = 120

export interface ChatFileStageDeps {
  resolveMedia(sessionId: string, messageId: string): Promise<WxMedia | undefined>
  /** The configured WeChat data root (settings › 账号); attachments must live under it. */
  accountRoot(): string | undefined
  /** `<cache>/previews` */
  stageDir: string
  /** The file allow-list: an attachment already inside it (a decrypted cache file) needs no copy. */
  isAllowed(path: string): boolean
}

/** A file name safe to create on every platform: no separators, control or reserved characters. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '')
  if (!cleaned) return 'file'
  if (cleaned.length <= MAX_NAME_CHARS) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, MAX_NAME_CHARS - ext.length) + ext
}

const stageKey = (sessionId: string, messageId: string): string =>
  createHash('sha256').update(`${sessionId}\u0000${messageId}`).digest('hex').slice(0, 24)

/** Copy the message's attachment into the preview cache (reusing an up-to-date copy) and return it. */
export async function stageChatFile(
  deps: ChatFileStageDeps,
  sessionId: string,
  messageId: string,
): Promise<{ path: string; fileName: string }> {
  const media = await deps.resolveMedia(sessionId, messageId)
  if (!media?.path) throw new Error(t('main.data.chatFileMissing'))
  let source: string
  try {
    source = await realpath(media.path)
  } catch (e) {
    throw new Error(t('main.data.chatFileMissing'), { cause: e })
  }
  const fileName = safeFileName(media.fileName || basename(source))
  if (deps.isAllowed(media.path) && deps.isAllowed(source)) return { path: source, fileName }
  const root = deps.accountRoot()
  if (!root || isForbiddenRoot(root)) throw new Error(t('main.data.chatFileOutside'))
  const realRoot = await realpath(root).catch(() => undefined)
  if (!realRoot || !isWithinRoot(source, realRoot)) throw new Error(t('main.data.chatFileOutside'))
  const st = await stat(source)
  if (!st.isFile()) throw new Error(t('main.data.chatFileMissing'))
  if (st.size > MAX_STAGE_BYTES) throw new Error(t('main.files.tooLarge', { mb: MAX_STAGE_BYTES / (1024 * 1024) }))

  const dir = join(deps.stageDir, stageKey(sessionId, messageId))
  const target = join(dir, fileName)
  // A missing copy is the normal first-time case, not an error.
  const existing = await stat(target).catch(() => undefined)
  if (existing?.isFile() && existing.size === st.size && existing.mtimeMs >= st.mtimeMs)
    return { path: target, fileName }
  await mkdir(dir, { recursive: true })
  await copyFile(source, target)
  return { path: target, fileName }
}
