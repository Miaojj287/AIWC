// Synchronises the canonical AIWC logo to the two places that consume application artwork.
// electron-builder converts build/icon.png into native .icns / .ico assets at package time;
// Vite copies public/app-icon.png for the browser tab, live window and in-app About screen.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'resources/branding/AIWC_Logo.png')
const outputs = [resolve(root, 'build/icon.png'), resolve(root, 'public/app-icon.png')]

for (const output of outputs) {
  mkdirSync(dirname(output), { recursive: true })
  copyFileSync(source, output)
  console.log('wrote', output)
}
