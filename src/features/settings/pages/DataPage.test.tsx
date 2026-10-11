// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_CATEGORIES, type StorageUsage, type UpdateState } from '@aiwc/protocol'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { clearToasts, getToasts } from '@/kit'
import { AboutPage } from './AboutPage'
import { DataPage } from './DataPage'

const { invokeMock, state } = vi.hoisted(() => ({
  invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>(),
  state: { usage: undefined as unknown, update: undefined as unknown },
}))
vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: (channel: string) => ({
    data: channel === 'storage:usage' ? state.usage : channel === 'update:getState' ? state.update : undefined,
    error: undefined,
    loading: false,
    reload: () => {},
  }),
}))

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const MB = 1024 * 1024
function usage(): StorageUsage {
  return {
    dataRoot: '/data/aiwc',
    totalBytes: 0,
    measuredAt: 0,
    categories: STORAGE_CATEGORIES.map((id) => ({
      id,
      bytes: id === 'plaintext' ? 300 * MB : id === 'logs' ? 0 : MB,
      files: 1,
    })),
  }
}

beforeEach(() => {
  state.usage = usage()
  state.update = undefined
  invokeMock.mockReset()
})
afterEach(() => {
  cleanup()
  clearToasts()
})

describe('DataPage', () => {
  it('confirms, clears a cache and reports what was freed', async () => {
    invokeMock.mockResolvedValue({ freedBytes: 300 * MB })
    const { container } = render(<DataPage />)
    const row = container.querySelector('[data-setting-row="data.plaintext"]') as HTMLElement
    expect(within(row).getByText('300 MB')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: '清除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('清除明文数据库副本？')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '清除' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('storage:clear', { category: 'plaintext' }))
    await waitFor(() => expect(getToasts().some((t) => t.kind === 'success' && t.text === '已释放 300 MB')).toBe(true))
  })

  it('does not offer to clear an empty cache', () => {
    const { container } = render(<DataPage />)
    const row = container.querySelector('[data-setting-row="data.logs"]') as HTMLElement
    const button = within(row).getByRole('button', { name: '清除' })
    expect(button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')).toBe(true)
  })

  it('deletes everything only after the confirm word is typed', async () => {
    invokeMock.mockResolvedValue(undefined)
    render(<DataPage />)
    fireEvent.click(screen.getByRole('button', { name: '清除全部数据…' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: '清除并重启' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '清除' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '清除并重启' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('storage:wipeAll', undefined))
  })
})

describe('AboutPage updates', () => {
  it('disables 检查更新 with the reason instead of claiming "up to date"', () => {
    state.update = { status: { state: 'idle' }, unavailable: 'no_feed' } satisfies UpdateState
    render(<AboutPage />)
    const button = screen.getByRole('button', { name: /检查更新/ })
    expect(button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('已是最新版本')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalledWith('app:checkUpdate', undefined)
  })

  it('offers 重启并安装 once an update is downloaded', async () => {
    state.update = { status: { state: 'ready', version: '0.2.0' }, unavailable: null } satisfies UpdateState
    invokeMock.mockResolvedValue(undefined)
    render(<AboutPage />)
    fireEvent.click(screen.getByRole('button', { name: '重启并安装' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update:install', undefined))
  })
})
