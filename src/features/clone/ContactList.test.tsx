// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloneStatus } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { ContactList } from './ContactList'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes ancestors with `:popover-open` / `:modal`, which jsdom's selector engine recurses on
// for seconds per menu open (see PersonaChat.test.tsx); jsdom has no top layer, so answer those directly.
const nativeMatches = Element.prototype.matches
const TOP_LAYER = new Set([':popover-open', ':modal'])

const BUILDING: CloneStatus = {
  state: 'building',
  progress: { done: 1, total: 4, step: 'reading', startedAt: 1_000 },
}
const ENTRIES = [
  { contactId: 'wxid_idle', displayName: 'Idle Friend', status: { state: 'none', messageCount: 900 } as CloneStatus },
  {
    contactId: 'wxid_failed',
    displayName: 'Failed Friend',
    status: { state: 'failed', error: 'model down', kind: 'model' } as CloneStatus,
  },
  { contactId: 'wxid_building', displayName: 'Busy Friend', status: BUILDING },
]

let started: string[]
let cancelled: string[]

beforeEach(() => {
  Element.prototype.matches = function (this: Element, selector: string) {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector)
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetShellStoreForTests()
  started = []
  cancelled = []
  const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['clone:list'] = () => ENTRIES
  bridge.handlers['clone:start'] = ({ contactId }) => {
    started.push(contactId)
  }
  bridge.handlers['clone:cancel'] = ({ contactId }) => {
    cancelled.push(contactId)
  }
  __setBridgeForTests(bridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
  Element.prototype.matches = nativeMatches
})

async function pickFromMenu(row: string, item: RegExp | string): Promise<void> {
  fireEvent.contextMenu(await screen.findByText(row))
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('ContactList menu', () => {
  it.each([
    ['Idle Friend', 'wxid_idle', /^开始克隆/],
    ['Failed Friend', 'wxid_failed', /^重试克隆/],
  ])(
    '%s: 开始 / 重试 opens the clone Tab (privacy note, range, model) instead of starting a build',
    async (name, id, item) => {
      const opened = vi.fn()
      const off = onCommand('tab.openClone', opened)
      try {
        render(<ContactList query="" activeObjectId={null} />)
        await pickFromMenu(name, item)

        await waitFor(() => expect(opened).toHaveBeenCalledWith({ contactId: id, title: name }))
        expect(started).toEqual([])
      } finally {
        off()
      }
    },
  )

  it('取消克隆 asks first, with the same dialog as the progress card; 继续克隆 keeps the build', async () => {
    render(<ContactList query="" activeObjectId={null} />)
    await pickFromMenu('Busy Friend', '取消克隆')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('取消克隆？')).toBeTruthy()
    expect(within(dialog).getByText(/已完成的 25% 进度不会保留/)).toBeTruthy()
    expect(cancelled).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: '继续克隆' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(cancelled).toEqual([])
  })

  it('cancels the build only after the dialog is confirmed', async () => {
    render(<ContactList query="" activeObjectId={null} />)
    await pickFromMenu('Busy Friend', '取消克隆')

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消克隆' }))

    await waitFor(() => expect(cancelled).toEqual(['wxid_building']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
