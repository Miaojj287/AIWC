// electron-builder afterPack: ad-hoc re-sign the bundled native helpers with the debugger entitlement
// so the packaged app can read WeChat's process memory (task_for_pid) and attach the login-time hook.
// Real distribution should sign with a Developer ID; ad-hoc is enough for local/self-built installs on
// a SIP-disabled machine. `wechat_xkey_helper` is the login-time capture hook (WeChat 4.x on macOS);
// `wechat_memory_scan_helper` is the read-only Mach memory/dump scanner.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { existsSync } = require('node:fs')

const HELPERS = ['wechat_memory_scan_helper', 'wechat_xkey_helper']

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const resources = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const ents = join(context.packager.projectDir, 'resources', 'macos', 'helper.entitlements.plist')
  for (const name of HELPERS) {
    const helper = join(resources, 'resources', 'native', 'darwin-arm64', name)
    if (!existsSync(helper)) continue
    try {
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', ents, '--options', 'runtime', helper], { stdio: 'inherit' })
      console.log('[afterPack] signed', helper)
    } catch (e) {
      console.warn(`[afterPack] ${name} sign failed (non-fatal):`, e.message)
    }
  }
}
