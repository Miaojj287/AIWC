// Build the background helper before normal desktop development and production builds.
const { spawnSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const action = process.argv[2]
const diagnostics = ['inspect', 'probe-search', 'probe-settings']
if (action && !diagnostics.includes(action)) { console.error('Unknown diagnostic action'); process.exit(1) }
if (process.platform !== 'darwin') { console.log('Background AX is unavailable on this platform; foreground fallback is disabled.'); process.exit(action ? 1 : 0) }
const root = resolve(__dirname, '..')
const dir = resolve(root, 'resources/native/darwin-' + process.arch)
const binary = resolve(dir, 'aiwc-background-helper')
mkdirSync(dir, { recursive: true })
const build = spawnSync('swiftc', [resolve(root, 'resources/macos/background-reply/helper.swift'), '-o', binary], { stdio: 'inherit' })
if (build.error || build.status !== 0) process.exit(build.status || 1)
if (diagnostics.includes(action)) {
  const result = spawnSync(binary, [], { input: JSON.stringify({ action }), encoding: 'utf8', timeout: 12000, maxBuffer: 65536 })
  if (result.error || result.status !== 0) { console.error('Diagnostic helper failed'); process.exit(1) }
  try {
    const data = JSON.parse(result.stdout)
    console.log(JSON.stringify(data, null, 2))
    process.exit(data.ok ? 0 : 1)
  } catch { console.error('Invalid diagnostic response'); process.exit(1) }
}
console.log(binary)
