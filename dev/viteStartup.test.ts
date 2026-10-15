import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { optimizeDeps, resolveConfig } from 'vite'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('scans the application entry without resolving dependencies from unrelated example apps', async () => {
  vi.stubEnv('AIWC_WEB_ONLY', '1')
  const root = mkdtempSync(join(tmpdir(), 'aiwc-vite-startup-'))
  roots.push(root)
  mkdirSync(join(root, 'Example', 'unrelated'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/main.ts"></script>')
  writeFileSync(join(root, 'main.ts'), 'export {}')
  writeFileSync(
    join(root, 'Example', 'unrelated', 'index.html'),
    '<script type="module">import "@fictional/uninstalled-example"</script>',
  )
  const config = await resolveConfig(
    {
      configFile: join(process.cwd(), 'vite.config.ts'),
      root,
      cacheDir: join(root, 'cache'),
      logLevel: 'silent',
    },
    'serve',
  )
  await expect(optimizeDeps(config, true)).resolves.toBeDefined()
})
