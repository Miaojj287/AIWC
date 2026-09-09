// vite-plugin-electron normally launches Electron.app in development, so macOS labels the Dock
// item "Electron" before application JavaScript can run. Export a complete, versioned local copy
// with AIWC metadata. Frameworks and helpers must stay inside this bundle for GUI startup.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { dirname, join, resolve } = require('node:path')

const electronExecutable = require('electron')

if (process.platform !== 'darwin') {
  module.exports = electronExecutable
} else {
  const root = resolve(__dirname, '..')
  const sourceContents = dirname(dirname(electronExecutable))
  const version = require('electron/package.json').version
  const wrapperApp = join(root, '.cache', 'aiwc-electron', version, 'AIWC.app')
  const wrapperContents = join(wrapperApp, 'Contents')

  // Chromium resolves helper executables relative to its framework. Symlinking Frameworks to
  // another bundle breaks that layout and crashes at GUI startup (even though --version works).
  if (!existsSync(join(wrapperContents, 'Info.plist'))) {
    mkdirSync(dirname(wrapperApp), { recursive: true })
    execFileSync('/usr/bin/ditto', [dirname(sourceContents), wrapperApp])
  }

  const plist = readFileSync(join(sourceContents, 'Info.plist'), 'utf8')
    .replace('<key>CFBundleDisplayName</key>\n\t<string>Electron</string>', '<key>CFBundleDisplayName</key>\n\t<string>AIWC</string>')
    .replace('<key>CFBundleIdentifier</key>\n\t<string>com.github.Electron</string>', '<key>CFBundleIdentifier</key>\n\t<string>com.aiwc.desktop.dev</string>')
    .replace('<key>CFBundleName</key>\n\t<string>Electron</string>', '<key>CFBundleName</key>\n\t<string>AIWC</string>')
  writeFileSync(join(wrapperContents, 'Info.plist'), plist)

  module.exports = join(wrapperContents, 'MacOS', 'Electron')
}
