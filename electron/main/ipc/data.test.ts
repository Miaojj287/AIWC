import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { createAllowList } from '../security/pathAllowList'
import { registerDataIpc } from './data'
import type { HostBridge } from './register'
import { createHandlerHarness } from './testing/handlerHarness'

vi.mock('electron', () => ({
  app: { relaunch: vi.fn(), once: vi.fn() },
  session: { defaultSession: { clearStorageData: vi.fn(async () => undefined) } },
}))
vi.mock('../i18n', () => ({ t: (key: string) => key }))

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-data-ipc-'))
  dirs.push(root)
  const allowed = join(root, 'allowed')
  const logger = { child: () => logger, warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
  const ipc = createHandlerHarness()
  const ctx = {
    logger,
    config: { get: () => ({ account: {} }) },
    allowList: createAllowList([allowed], { home: join(root, 'home') }),
    broadcast: vi.fn(),
    toast: vi.fn(),
  } as unknown as AppContext
  registerDataIpc(ctx, { isPackaged: false, appVersion: '0.1.0', quit: vi.fn() } as unknown as HostBridge, ipc.handle)
  return { ipc, root, allowed }
}

describe('data IPC', () => {
  it('rejects a category that is not a rebuildable cache', async () => {
    const { ipc } = setup()
    await expect(Promise.resolve().then(() => ipc.invokeRaw('storage:clear', { category: 'memory' }))).rejects.toThrow(
      'main.ipc.operationFailed',
    )
    await expect(
      Promise.resolve().then(() => ipc.invokeRaw('storage:clear', { category: 'logs', x: 1 })),
    ).rejects.toThrow('main.ipc.operationFailed')
  })

  it('only previews documents inside the allow-list', async () => {
    const { ipc, root } = setup()
    const outside = join(root, 'secret.docx')
    writeFileSync(outside, 'x')
    await expect(Promise.resolve().then(() => ipc.invoke('file:previewDocument', { path: outside }))).rejects.toThrow()
  })

  it('validates stage requests and says why updating is off in a dev build', async () => {
    const { ipc } = setup()
    await expect(
      Promise.resolve().then(() => ipc.invokeRaw('file:stageChatFile', { sessionId: '', messageId: 'm' })),
    ).rejects.toThrow('main.ipc.operationFailed')
    expect(await ipc.invoke('update:getState', undefined)).toEqual({
      status: { state: 'idle' },
      unavailable: 'dev_build',
    })
    await expect(Promise.resolve().then(() => ipc.invoke('app:checkUpdate', undefined))).rejects.toThrow(
      'main.data.update.devBuild',
    )
  })
})
