import { describe, expect, it, vi } from 'vitest'
import {
  defaultConfig,
  type AppConfig,
  type InstalledPet,
  type InvokeChannel,
  type InvokeReq,
  type InvokeRes,
} from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { InstallOptions, PetService } from '../services/petService'
import type { HostBridge } from './register'
import { registerPetIpc } from './pet'
import { createHandlerHarness } from './testing/handlerHarness'

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog: { showOpenDialog } }))

const pet = (id: string): InstalledPet => ({
  id,
  displayName: id,
  description: '',
  builtin: false,
  source: 'catalog',
  spriteVersion: 2,
  spriteUrl: `aiwc-media:///pets/${id}/spritesheet.webp`,
})

function setup(service: Partial<PetService> = {}, current?: string) {
  let config: AppConfig = { ...defaultConfig(), pet: { ...defaultConfig().pet, current } }
  const broadcast = vi.fn()
  const configService = { get: () => config, replace: vi.fn((next: AppConfig) => (config = next)) }
  const ipc = createHandlerHarness()
  registerPetIpc(
    { pets: service as PetService, broadcast, config: configService } as unknown as AppContext,
    { getMainWindow: () => undefined } as unknown as HostBridge,
    ipc.handle,
  )
  const invoke = async <K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> =>
    ipc.invoke(channel, req)
  return { invoke, broadcast, configService, config: () => config }
}

describe('pet ipc', () => {
  it('relays install steps, announces the new pet, and refuses a second install of the same id', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const install = vi.fn(async (id: string, opts?: InstallOptions) => {
      opts?.onStep?.('download', 'doing')
      await gate
      opts?.onStep?.('download', 'done')
      return pet(id)
    })
    const { invoke, broadcast } = setup({ install })
    const first = invoke('pet:install', { id: 'dewey' })
    await expect(invoke('pet:install', { id: 'dewey' })).rejects.toThrow('正在领养中')
    release()
    expect((await first).id).toBe('dewey')
    expect(broadcast.mock.calls).toEqual([
      ['pet:installStep', { id: 'dewey', step: 'download', status: 'doing', detail: undefined }],
      ['pet:installStep', { id: 'dewey', step: 'download', status: 'done', detail: undefined }],
      ['pet:changed', { reason: 'installed', id: 'dewey' }],
    ])
    await expect(invoke('pet:install', { id: '../x' })).rejects.toThrow('无效的宠物 id')
  })

  it('cancels a running install through its abort signal', async () => {
    const install = vi.fn(
      (_id: string, opts?: InstallOptions) =>
        new Promise<InstalledPet>((_, reject) =>
          opts?.signal?.addEventListener('abort', () => reject(new Error('已取消领养'))),
        ),
    )
    const { invoke } = setup({ install })
    const running = invoke('pet:install', { id: 'dewey' })
    await invoke('pet:cancelInstall', { id: 'dewey' })
    await expect(running).rejects.toThrow('已取消领养')
  })

  it('imports only what the user picked in the system dialog', async () => {
    const importZip = vi.fn(async () => pet('nessie'))
    const { invoke, broadcast } = setup({ importZip })
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await invoke('pet:import', undefined)).toBeNull()
    expect(importZip).not.toHaveBeenCalled()
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/me/Downloads/nessie.zip'] })
    expect((await invoke('pet:import', undefined))?.id).toBe('nessie')
    expect(importZip).toHaveBeenCalledWith('/Users/me/Downloads/nessie.zip')
    expect(broadcast).toHaveBeenCalledWith('pet:changed', { reason: 'imported', id: 'nessie' })
  })

  it('clears the selection when the current pet is removed', async () => {
    const remove = vi.fn(async () => undefined)
    const { invoke, configService, config, broadcast } = setup({ remove }, 'dewey')
    await invoke('pet:remove', { id: 'other' })
    expect(configService.replace).not.toHaveBeenCalled()
    await invoke('pet:remove', { id: 'dewey' })
    expect(config().pet.current).toBeUndefined()
    expect(config().pet.enabled).toBe(true)
    expect(broadcast).toHaveBeenLastCalledWith('pet:changed', { reason: 'removed', id: 'dewey' })
  })
})
