const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const { mkdirSync, rmSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')

const entry = process.argv[2]
if (!entry) {
  console.error('Usage: node scripts/run-bundled-node-test.cjs <test-file>')
  process.exit(2)
}

const projectRoot = resolve(__dirname, '..')
const outputDir = join(projectRoot, '.tmp', 'bundled-tests')
const outputFile = join(outputDir, `${basename(entry).replace(/\.[^.]+$/, '')}-${process.pid}.mjs`)
mkdirSync(outputDir, { recursive: true })

try {
  buildSync({
    entryPoints: [resolve(projectRoot, entry)],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    sourcemap: 'inline',
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, [outputFile], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(outputFile, { force: true })
}
