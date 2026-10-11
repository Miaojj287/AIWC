/**
 * 设置 › 常规 › 开机自启 → the OS login item. Only a packaged build registers itself: a development run would register
 * the bare Electron binary. Linux has no login-item API in Electron, so the setting is simply stored there.
 */
export interface LoginItemTarget {
  isPackaged: boolean
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

export function supportsLoginItem(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** Returns true when the OS setting was written. */
export function applyLoginItem(target: LoginItemTarget, platform: NodeJS.Platform, launchAtLogin: boolean): boolean {
  if (!target.isPackaged || !supportsLoginItem(platform)) return false
  target.setLoginItemSettings({ openAtLogin: launchAtLogin })
  return true
}
