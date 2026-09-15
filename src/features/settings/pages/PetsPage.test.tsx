// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type CatalogPet, type InstalledPet } from '@aiwc/protocol'
import { __resetPetStoreForTests } from '@/features/pets'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { clearToasts, getToasts } from '@/kit'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { PetsPage } from './PetsPage'

const { invokeMock, saveConfigMock, refreshConfigMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>(),
  saveConfigMock: vi.fn(async () => true),
  refreshConfigMock: vi.fn(async () => undefined),
}))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))
vi.mock('../hooks', () => ({
  saveConfig: saveConfigMock,
  refreshConfig: refreshConfigMock,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const installed = (id: string, patch: Partial<InstalledPet> = {}): InstalledPet => ({
  id,
  displayName: id.toUpperCase(),
  description: '',
  builtin: false,
  source: 'catalog',
  spriteVersion: 2,
  spriteUrl: `aiwc-media:///pets/${id}.webp`,
  ...patch,
})
const catalog = (id: string, patch: Partial<CatalogPet> = {}): CatalogPet => ({
  id,
  displayName: `Cat ${id}`,
  description: '',
  tags: [],
  spriteVersion: 2,
  posterUrl: `https://codex-pets.net/${id}/poster.webp`,
  spritesheetUrl: `https://codex-pets.net/${id}/s.webp`,
  likeCount: 0,
  downloadCount: 0,
  installed: false,
  ...patch,
})

let pets: InstalledPet[]

function seed(current?: string) {
  const base = defaultConfig()
  useConfigStore.setState({ config: { ...base, pet: { ...base.pet, current } }, hydrated: true, error: undefined })
}

beforeEach(() => {
  __resetConfigStoreForTests()
  __resetPetStoreForTests()
  clearToasts()
  pets = [
    installed('aiwcji', { builtin: true, source: 'builtin', displayName: 'AIWC 鸡', spriteVersion: 1 }),
    installed('dewey', { displayName: 'Dewey', author: 'dan' }),
  ]
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel, req) => {
    switch (channel) {
      case 'pet:list':
        return pets
      case 'pet:catalog':
        return {
          page: 1,
          pageSize: 30,
          total: 2,
          totalPages: 1,
          pets: [catalog('nessie'), catalog('dewey', { installed: true, displayName: 'Dewey' })],
        }
      case 'pet:install': {
        const pet = installed((req as { id: string }).id, { displayName: 'Nessie' })
        pets = [...pets, pet]
        return pet
      }
      case 'pet:remove':
        pets = pets.filter((p) => p.id !== (req as { id: string }).id)
        return undefined
      default:
        return undefined
    }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('设置 › 宠物', () => {
  it('previews the bundled pet by default and selects another pet on click', async () => {
    seed()
    render(<PetsPage />)
    const preview = await screen.findByTestId('current-pet-preview')
    expect(within(preview).getByText('AIWC 鸡')).toBeTruthy()
    expect(within(preview).getByText('内置')).toBeTruthy()
    // v1 sheets have no look-around rows, so those preview chips are not offered
    expect(within(preview).queryByRole('button', { name: '左看看' })).toBeNull()

    const grid = screen.getByRole('list', { name: '我的宠物' })
    expect(within(grid).getByRole('listitem', { name: 'AIWC 鸡（正在使用）' })).toBeTruthy()
    fireEvent.click(within(grid).getByRole('listitem', { name: 'Dewey' }))
    expect(saveConfigMock).toHaveBeenCalledWith({ pet: { current: 'dewey', enabled: true } })
  })

  it('applies toggles instantly', async () => {
    seed()
    render(<PetsPage />)
    await screen.findByTestId('current-pet-preview')
    fireEvent.click(screen.getByRole('switch', { name: '在 Agent 面板显示宠物' }))
    expect(saveConfigMock).toHaveBeenCalledWith({ pet: { enabled: false } })
    fireEvent.click(screen.getByRole('radio', { name: '大' }))
    expect(saveConfigMock).toHaveBeenCalledWith({ pet: { size: 'lg' } })
  })

  it('adopts a gallery pet through the install channel and switches to it', async () => {
    seed()
    render(<PetsPage />)
    const gallery = await screen.findByRole('list', { name: '宠物图库' })
    expect(within(gallery).getByRole('button', { name: '选用「Dewey」' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(gallery).getByRole('button', { name: '领养「Cat nessie」' }))
    })
    await waitFor(() => expect(saveConfigMock).toHaveBeenCalledWith({ pet: { current: 'nessie', enabled: true } }))
    expect(invokeMock).toHaveBeenCalledWith('pet:install', { id: 'nessie' })
    expect(getToasts().some((t) => t.text === '已领养「Nessie」')).toBe(true)
  })

  it('deletes a pet only after the danger confirmation, and never offers deleting the bundled one', async () => {
    seed('dewey')
    render(<PetsPage />)
    const grid = await screen.findByRole('list', { name: '我的宠物' })

    fireEvent.contextMenu(within(grid).getByRole('listitem', { name: 'AIWC 鸡' }))
    expect((await screen.findByRole('menuitem', { name: /删除/ })).getAttribute('data-disabled')).not.toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    fireEvent.contextMenu(within(grid).getByRole('listitem', { name: 'Dewey（正在使用）' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('删除宠物「Dewey」？')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalledWith('pet:remove', expect.anything())
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    })
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet:remove', { id: 'dewey' }))
    expect(refreshConfigMock).toHaveBeenCalled()
  })

  it('shows a retryable error when the gallery cannot load', async () => {
    seed()
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'pet:list') return pets
      if (channel === 'pet:catalog') throw new Error('无法连接 codex-pets.net：fetch failed')
      return undefined
    })
    render(<PetsPage />)
    expect(await screen.findByText('宠物图库加载失败')).toBeTruthy()
    expect(screen.getByText('无法连接 codex-pets.net：fetch failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
