import { describe, expect, it, vi } from 'vitest'
import type { InvokeChannel, MemoryFile } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import { registerMemoryIpc } from './memory'
import type { HostBridge } from './register'
import { createHandlerHarness } from './testing/handlerHarness'

function setup() {
  const memory = {
    read: vi.fn(async (_file: MemoryFile) => ''),
    write: vi.fn(async () => undefined),
    entries: vi.fn(async () => []),
    budget: vi.fn(async (file: MemoryFile) => ({ file, usedChars: 0, limitChars: 100 })),
  }
  const toast = vi.fn()
  const ipc = createHandlerHarness()
  registerMemoryIpc({ memory, toast } as unknown as AppContext, {} as HostBridge, ipc.handle)
  const invokeRaw = (channel: InvokeChannel, req: unknown): Promise<unknown> =>
    Promise.resolve().then(() => ipc.invokeRaw(channel, req))
  return { ipc, invokeRaw, memory, toast }
}

describe('memory IPC', () => {
  it('refuses any file outside the four memory files before the store is touched', async () => {
    const { invokeRaw, memory, toast } = setup()
    for (const file of ['../skills/user/x/SKILL', 'memory', 'SOUL.md', '', 42, undefined]) {
      for (const channel of ['memory:read', 'memory:entries', 'memory:budget', 'memory:clear'] as const)
        await expect(invokeRaw(channel, { file }), `${channel} ${String(file)}`).rejects.toThrow(
          t('main.files.unknownMemoryFile'),
        )
      await expect(invokeRaw('memory:write', { file, markdown: 'x' })).rejects.toThrow(
        t('main.files.unknownMemoryFile'),
      )
    }
    for (const fn of [...Object.values(memory), toast]) expect(fn).not.toHaveBeenCalled()
  })

  it('passes the four memory files through', async () => {
    const { ipc, memory, toast } = setup()
    for (const file of ['MEMORY', 'USER', 'SOUL', 'AGENTS'] as const) await ipc.invoke('memory:read', { file })
    expect(memory.read.mock.calls.map(([file]) => file)).toEqual(['MEMORY', 'USER', 'SOUL', 'AGENTS'])
    await ipc.invoke('memory:clear', { file: 'MEMORY' })
    expect(memory.write).toHaveBeenCalledWith('MEMORY', '', { source: 'user' })
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
