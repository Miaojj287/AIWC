/**
 * Leaving the app: links and local files. Both used to be fired at `app:openPath` and forgotten, so a
 * denied path or an unsupported scheme produced nothing at all — no window, no error, no way for the
 * user to tell whether the click registered (交互准则 1 / 14 / 15).
 *
 * `app:openPath` resolves a real file against the path allow-list and therefore rejects every URL;
 * `app:openUrl` hands http(s) / mailto / OS-settings links to the system browser. `openTarget` picks
 * the right one, so callers can just pass whatever the message or document contained.
 */
import { toast } from '@/kit'
import { invoke } from './hooks'

const URL_SCHEME = /^(?:https?|mailto|x-apple\.systempreferences|ms-settings):/i

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function isExternalUrl(target: string): boolean {
  return URL_SCHEME.test(target.trim())
}

/** Open an http(s) / mailto / settings URL in the system browser. Reports failures as a toast. */
export async function openUrl(url: string): Promise<void> {
  try {
    await invoke('app:openUrl', { url })
  } catch (e) {
    toast.error('无法打开链接', { detail: message(e) })
  }
}

/** Open a local file or folder with the system default application. Reports failures as a toast. */
export async function openLocalPath(path: string, what = '文件'): Promise<void> {
  try {
    await invoke('app:openPath', { path })
  } catch (e) {
    toast.error(`无法打开${what}`, { detail: message(e) })
  }
}

/** Route by shape: URLs go to the browser, everything else to the file opener. */
export async function openTarget(target: string, what = '文件'): Promise<void> {
  return isExternalUrl(target) ? openUrl(target) : openLocalPath(target, what)
}

/** Reveal a file in Finder / Explorer. Reports failures as a toast. */
export async function revealPath(path: string): Promise<void> {
  try {
    await invoke('file:reveal', { path })
  } catch (e) {
    toast.error('无法在文件夹中显示', { detail: message(e) })
  }
}
