import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { fileURLToPath, URL } from 'node:url'
import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const devElectronPackage = here('./scripts/aiwc-electron.cjs')
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8')) as { dependencies?: Record<string, string> }

const aliases = {
  '@aiwc/protocol': here('./packages/protocol/src/index.ts'),
  '@aiwc/kernel': here('./packages/kernel/src/index.ts'),
  '@aiwc/substrate': here('./packages/substrate/src/index.ts'),
  '@aiwc/gateway': here('./packages/gateway/src/index.ts'),
  '@aiwc/memory': here('./packages/memory/src/index.ts'),
  '@': here('./src'),
}

// Main-process bundles: keep native / heavy deps external, bundle the AI SDK so that a
// single ESM graph is produced (mirrors the proven AIWC_ORG setup).
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
const bundleInMain = (id: string) => id === 'ai' || id.startsWith('ai/') || id.startsWith('@ai-sdk/') || id === 'zod' || id.startsWith('zod/')
const externalDeps = Object.keys(pkg.dependencies ?? {}).filter((n) => !bundleInMain(n))
const external = (id: string) => {
  if (nodeBuiltins.has(id)) return true
  if (bundleInMain(id)) return false
  return externalDeps.some((n) => id === n || id.startsWith(`${n}/`))
}

const webOnly = process.env.AIWC_WEB_ONLY === '1'

const mainEntries = [
  { entry: 'electron/main/index.ts', out: 'main' },
  { entry: 'electron/hosts/substrateHost.ts', out: 'substrateHost' },
]

export default defineConfig({
  base: './',
  resolve: { alias: aliases },
  server: { host: '127.0.0.1', port: 5177, strictPort: false },
  plugins: [
    tailwindcss(),
    react(),
    ...(webOnly
      ? []
      : [
          electron([
            ...mainEntries.map(({ entry, out }) => ({
              entry,
              onstart({ startup }: { startup: (argv?: string[], options?: import('node:child_process').SpawnOptions, customElectronPkg?: string) => Promise<boolean> }) {
                return startup(undefined, undefined, devElectronPackage).then(() => undefined)
              },
              vite: {
                resolve: { alias: aliases },
                build: {
                  outDir: 'dist-electron',
                  sourcemap: true,
                  rollupOptions: { external, output: { entryFileNames: `${out}.js` } },
                },
              },
            })),
            {
              entry: 'electron/preload/index.ts',
              onstart(options) {
                // reload() falls back to the stock Electron bundle when nothing is running yet.
                if ((process as NodeJS.Process & { electronApp?: import('node:child_process').ChildProcess }).electronApp) options.reload()
                else return options.startup(undefined, undefined, devElectronPackage).then(() => undefined)
              },
              vite: {
                resolve: { alias: aliases },
                build: {
                  outDir: 'dist-electron',
                  // Sandboxed preloads must be CommonJS. vite-plugin-electron forces lib.formats=["es"] for a
                  // "type":"module" package; passing output as an ARRAY makes Vite ignore lib.formats, and
                  // minify:false keeps esbuild from re-wrapping the *.cjs chunk as an ES module.
                  minify: false,
                  rollupOptions: { output: [{ entryFileNames: 'preload.cjs', format: 'cjs', exports: 'none' }] },
                },
              },
            },
          ]),
          renderer(),
        ]),
  ],
  build: { outDir: 'dist', sourcemap: true },
})
