import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { createPaths, defaultAllowedRoots, ensureDirs, extensionsFile, protectedDataPaths } from '../paths'
import { createAllowList } from '../security/pathAllowList'
import { registerFileIpc } from './file'
import type { HostBridge } from './register'
import { createHandlerHarness } from './testing/handlerHarness'

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))

const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf]
const FIVE_MB = 5 * 1024 * 1024

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const exportsDir = mkdtempSync(join(tmpdir(), 'aiwc-file-ipc-'))
  dirs.push(exportsDir)
  const warn = vi.fn()
  const logger = { child: () => logger, warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() }
  const ipc = createHandlerHarness()
  registerFileIpc(
    { logger, paths: { exportsDir }, allowList: {} } as unknown as AppContext,
    {} as HostBridge,
    ipc.handle,
  )
  const reject = (req: unknown) => Promise.resolve().then(() => ipc.invokeRaw('file:saveExport', req))
  return { ipc, exportsDir, warn, reject }
}

describe('file:saveExport', () => {
  it('writes the CSV into the exports folder behind a UTF-8 BOM, so Excel reads the Chinese', async () => {
    const { ipc, exportsDir } = setup()
    const content = '名称,数量\r\n"苹果, 红",3\r\n'
    const { path } = await ipc.invoke('file:saveExport', { name: '表格', ext: 'csv', content })
    expect(dirname(path)).toBe(exportsDir)
    expect(basename(path)).toMatch(/^表格-\d{8}-\d{6}\.csv$/)
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 3)]).toEqual(UTF8_BOM_BYTES)
    expect(bytes.subarray(3).toString('utf8')).toBe(content)
  })

  it('keeps a BOM the content already starts with instead of doubling it', async () => {
    const { ipc } = setup()
    const { path } = await ipc.invoke('file:saveExport', {
      name: 'table',
      ext: 'csv',
      content: `${String.fromCharCode(0xfeff)}a,b\r\n`,
    })
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 3)]).toEqual(UTF8_BOM_BYTES)
    expect(bytes.subarray(3).toString('utf8')).toBe('a,b\r\n')
  })

  it('only ever writes inside the exports folder, whatever the name says', async () => {
    const { ipc, exportsDir } = setup()
    for (const name of ['../../escape', '/etc/passwd', 'a\\b:c', '']) {
      const { path } = await ipc.invoke('file:saveExport', { name, ext: 'csv', content: 'x' })
      expect(dirname(path)).toBe(exportsDir)
    }
    expect(readdirSync(exportsDir)).toHaveLength(4)
  })

  it('rejects a malformed request before touching the disk, without logging what it contained', async () => {
    const { exportsDir, warn, reject } = setup()
    const bad: unknown[] = [
      { name: 'x', ext: 'exe', content: 'x' },
      { name: 'x', ext: 'md', content: 'x' },
      { name: 'x'.repeat(121), ext: 'csv', content: 'x' },
      { name: 'x', ext: 'csv', content: 42 },
      { name: 'x', ext: 'csv', content: 'x', path: '/tmp/x.csv' },
      { ext: 'csv', content: 'x' },
      undefined,
    ]
    for (const req of bad) await expect(reject(req)).rejects.toThrow('操作失败，请重试')
    expect(readdirSync(exportsDir)).toEqual([])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('xxxxxxxx')
  })

  it('refuses more than 5 MB of UTF-8, counted in bytes', async () => {
    const { ipc, exportsDir, reject } = setup()
    await expect(
      reject({ name: 'big', ext: 'csv', content: '表'.repeat(Math.floor(FIVE_MB / 3) + 1) }),
    ).rejects.toThrow('文件过大（超过 5 MB）')
    expect(readdirSync(exportsDir)).toEqual([])
    const { path } = await ipc.invoke('file:saveExport', { name: 'ok', ext: 'csv', content: 'a'.repeat(FIVE_MB) })
    expect(readFileSync(path).length).toBe(FIVE_MB + UTF8_BOM_BYTES.length)
  })
})

describe('file:write', () => {
  function setupWrite() {
    // Resolved: on macOS the temp dir is a symlink (/var → /private/var), as the real userData never is.
    const userData = realpathSync(mkdtempSync(join(tmpdir(), 'aiwc-file-write-')))
    dirs.push(userData)
    const paths = createPaths({
      userData,
      isPackaged: false,
      resourcesPath: userData,
      appPath: userData,
      platform: process.platform,
      arch: process.arch,
    })
    ensureDirs(paths)
    const logger = { child: () => logger, warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
    const ipc = createHandlerHarness()
    // Real allow-list and the real protected list: the data root is an allowed root, its stores are not writable.
    const ctx = {
      logger,
      paths,
      allowList: createAllowList(defaultAllowedRoots(paths)),
      protectedPaths: () => protectedDataPaths(paths),
    }
    registerFileIpc(ctx as unknown as AppContext, {} as HostBridge, ipc.handle)
    const write = (path: string) => Promise.resolve().then(() => ipc.invoke('file:write', { path, content: 'x' }))
    return { paths, write }
  }

  it('writes a Markdown file the user edits in the workspace', async () => {
    const { paths, write } = setupWrite()
    const target = join(paths.workspaceDir, 'notes', 'plan.md')
    await write(target)
    expect(readFileSync(target, 'utf8')).toBe('x')
  })

  it("refuses the app's own stores under the data root: hooks / MCP commands, tasks, phone push state, config, keys", async () => {
    const { paths, write } = setupWrite()
    const targets = [
      extensionsFile(paths),
      join(paths.tasksDir, 'tasks.json'),
      join(paths.mobileDir, 'state.json'),
      paths.configFile,
      paths.secretsFile,
      `${paths.mirrorDb}-wal`,
      join(paths.memoryDir, 'MEMORY.md'),
      join(paths.workspaceDir, '..', 'extensions.json'),
    ]
    for (const target of targets) await expect(write(target)).rejects.toThrow('该路径不在允许访问的目录内')
    expect(existsSync(extensionsFile(paths))).toBe(false)
    expect(existsSync(paths.configFile)).toBe(false)
  })

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')(
    'refuses a differently-cased name on a case-insensitive filesystem',
    async () => {
      const { paths, write } = setupWrite()
      await expect(write(join(paths.dataRoot, 'EXTENSIONS.json'))).rejects.toThrow('该路径不在允许访问的目录内')
      await expect(write(join(paths.dataRoot, 'Tasks', 'tasks.json'))).rejects.toThrow('该路径不在允许访问的目录内')
    },
  )

  it.skipIf(process.platform === 'win32')('refuses a store reached through a symlinked folder', async () => {
    const { paths, write } = setupWrite()
    mkdirSync(paths.tasksDir, { recursive: true })
    writeFileSync(join(paths.tasksDir, 'tasks.json'), '[]')
    symlinkSync(paths.tasksDir, join(paths.workspaceDir, 'linked'))
    await expect(write(join(paths.workspaceDir, 'linked', 'tasks.json'))).rejects.toThrow('该路径不在允许访问的目录内')
    expect(readFileSync(join(paths.tasksDir, 'tasks.json'), 'utf8')).toBe('[]')
  })
})
