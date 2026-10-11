// vite-plugin-electron normally launches Electron.app in development, so macOS labels the Dock
// item "Electron" before application JavaScript can run. Export a complete, versioned local copy
// with AIWC metadata. Frameworks and helpers must stay inside this bundle for GUI startup.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { dirname, join, resolve } = require('node:path')

const electronExecutable = require('electron')

if (process.platform !== 'darwin') {
  module.exports = electronExecutable
} else {
  const root = resolve(__dirname, '..')
  const sourceContents = dirname(dirname(electronExecutable))
  const version = require('electron/package.json').version
  let artwork = readFileSync(join(root, 'build', 'icon.png'))
  const artworkVersion = createHash('sha256').update(artwork).digest('hex').slice(0, 12)
  const wrapperApp = join(root, '.cache', 'aiwc-electron', `${version}-${artworkVersion}`, 'AIWC.app')
  const wrapperContents = join(wrapperApp, 'Contents')

  // Chromium resolves helper executables relative to its framework. Symlinking Frameworks to
  // another bundle breaks that layout and crashes at GUI startup (even though --version works).
  if (!existsSync(join(wrapperContents, 'Info.plist'))) {
    mkdirSync(dirname(wrapperApp), { recursive: true })
    execFileSync('/usr/bin/ditto', [dirname(sourceContents), wrapperApp], { timeout: 60_000 })
  }

  const plist = readFileSync(join(sourceContents, 'Info.plist'), 'utf8')
    .replace(
      '<key>CFBundleDisplayName</key>\n\t<string>Electron</string>',
      '<key>CFBundleDisplayName</key>\n\t<string>AIWC</string>',
    )
    .replace(
      '<key>CFBundleIdentifier</key>\n\t<string>com.github.Electron</string>',
      '<key>CFBundleIdentifier</key>\n\t<string>com.aiwc.desktop.dev</string>',
    )
    .replace('<key>CFBundleName</key>\n\t<string>Electron</string>', '<key>CFBundleName</key>\n\t<string>AIWC</string>')
  writeFileSync(join(wrapperContents, 'Info.plist'), plist)

  // macOS notification authorization uses the bundle icon, not app.dock.setIcon(). The canonical
  // 1024px PNG is a valid ic10 representation; preserve it losslessly inside an ICNS container.
  if (artwork.readUInt32BE(16) !== 1024 || artwork.readUInt32BE(20) !== 1024) {
    const resized = join(wrapperContents, 'Resources', 'aiwc-icon.png')
    execFileSync('/usr/bin/sips', ['-z', '1024', '1024', join(root, 'build', 'icon.png'), '--out', resized], {
      timeout: 30_000,
      stdio: 'pipe',
    })
    artwork = readFileSync(resized)
  }
  const header = Buffer.alloc(16)
  header.write('icns', 0)
  header.writeUInt32BE(artwork.length + 16, 4)
  header.write('ic10', 8)
  header.writeUInt32BE(artwork.length + 8, 12)
  writeFileSync(join(wrapperContents, 'Resources', 'electron.icns'), Buffer.concat([header, artwork]))

  module.exports = join(wrapperContents, 'MacOS', 'Electron')
}
