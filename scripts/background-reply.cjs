// Explicit developer opt-in. Never launched by the regular build or startup path.
const { spawnSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
if (process.platform !== 'darwin') { console.error('Background AX requires macOS'); process.exit(1) }
const root = resolve(__dirname, '..')
const dir = resolve(root, '.cache/background-reply')
const binary = resolve(dir, 'aiwc-background-helper')
mkdirSync(dir, { recursive: true })
const build = spawnSync('swiftc', [resolve(root, 'resources/macos/background-reply/helper.swift'), '-o', binary], { stdio: 'inherit' })
if (build.error || build.status !== 0) process.exit(build.status || 1)
if (process.argv[2] === 'inspect') {
  const result = spawnSync(binary, [], { input: JSON.stringify({ action: 'inspect' }), encoding: 'utf8' })
  if (result.error || result.status !== 0) { console.error('Diagnostic helper failed'); process.exit(1) }
  try {
    const data = JSON.parse(result.stdout)
    console.log(JSON.stringify(data, null, 2))
    process.exit(data.ok ? 0 : 1)
  } catch { console.error('Invalid diagnostic response'); process.exit(1) }
}
console.log(binary)
