// electron-builder afterPack: re-sign the bundled helpers with the process-read entitlement.
// The codec helper authenticates version-bound database credentials without attaching a debugger;
// the legacy memory helper is used only for explicit image recovery. Production distribution should
// use a Developer ID. Ad-hoc signing does not prove access in a SIP-enabled distribution environment.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { existsSync } = require('node:fs')

const HELPERS = ['wechat_memory_scan_helper', 'wechat_codec_helper']
const MAC_ARCHITECTURES = ['arm64', 'x64']

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const resources = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const ents = join(context.packager.projectDir, 'resources', 'macos', 'helper.entitlements.plist')
  for (const architecture of MAC_ARCHITECTURES) {
    for (const name of HELPERS) {
      const helper = join(resources, 'resources', 'native', `darwin-${architecture}`, name)
      if (!existsSync(helper)) {
        if (name === 'wechat_codec_helper') throw new Error(`Missing codec helper for ${architecture}`)
        continue
      }
      try {
        execFileSync(
          '/usr/bin/codesign',
          ['--force', '--sign', '-', '--entitlements', ents, '--options', 'runtime', helper],
          { stdio: 'inherit' },
        )
        console.log('[afterPack] signed', helper)
      } catch (e) {
        if (name === 'wechat_codec_helper') throw e
        console.warn(`[afterPack] ${name} sign failed (non-fatal):`, e.message)
      }
    }
  }
}
