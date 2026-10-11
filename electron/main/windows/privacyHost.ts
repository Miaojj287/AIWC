/**
 * The OS facilities composePrivacy needs (it stays electron-free for tests): the macOS Accessibility check that never
 * prompts, a fingerprint of this exact build, and the recoverable trash used by 撤销.
 */
import { statSync } from 'node:fs'
import { app, shell, systemPreferences } from 'electron'
import type { PrivacyHost } from '../composePrivacy'

export function createPrivacyHost(): PrivacyHost {
  return {
    isAccessibilityTrusted: () =>
      process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : false,
    // macOS ties the Accessibility grant to the exact binary: a new version or a rebuilt executable needs re-granting.
    fingerprint: () => {
      let built = 0
      try {
        built = Math.round(statSync(process.execPath).mtimeMs)
      } catch {
        // unreadable executable: version + path still tell most updates apart
        built = 0
      }
      return `${app.getVersion()}|${process.execPath}|${built}`
    },
    trash: (path) => shell.trashItem(path),
  }
}
