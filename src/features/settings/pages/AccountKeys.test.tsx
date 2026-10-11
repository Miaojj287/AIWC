import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AiwcBridge, KeyAcquireStep } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { InlineKeyAcquire } from './AccountKeys'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

function setup(result: Promise<KeyAcquireStep[]>) {
  const invoke = vi.fn((channel: string) => (channel === 'substrate:acquireKeys' ? result : Promise.resolve()))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const onClose = vi.fn()
  return { invoke, onClose }
}

it('asks main for the image keys only, so getting them never restarts WeChat', async () => {
  const { invoke, onClose } = setup(new Promise(() => {}))
  render(
    <TooltipProvider>
      <InlineKeyAcquire
        wxid="wxid_a"
        dbRoot="/root"
        scope="image"
        onFinished={vi.fn()}
        onManual={vi.fn()}
        onClose={onClose}
      />
    </TooltipProvider>,
  )
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('substrate:acquireKeys', {
      wxid: 'wxid_a',
      dbRoot: '/root',
      strategy: 'auto',
      scope: 'image',
    }),
  )
  // Only the two image steps are listed.
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('substrate:cancelAcquireKeys', undefined))
  expect(onClose).toHaveBeenCalled()
})

it('explains a Developer Tools denial and links to the setting', async () => {
  const { onClose } = setup(
    Promise.resolve([
      { id: 'db_key', label: '', status: 'failed', failure: 'needs_authorization' },
      { id: 'image_xor', label: '', status: 'done' },
      { id: 'image_aes', label: '', status: 'done' },
      { id: 'verify', label: '', status: 'failed', failure: 'skipped' },
    ]),
  )
  render(
    <TooltipProvider>
      <InlineKeyAcquire
        wxid="wxid_a"
        dbRoot="/root"
        scope="all"
        onFinished={vi.fn()}
        onManual={vi.fn()}
        onClose={onClose}
      />
    </TooltipProvider>,
  )
  await screen.findByText(/开发者工具/)
  screen.getByRole('button', { name: '打开系统设置' })
  expect(onClose).not.toHaveBeenCalled()
})
