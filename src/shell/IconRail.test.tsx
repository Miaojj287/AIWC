// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiwcBridge } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { useTabsStore } from '@/workspace/tabsStore'
import { IconRail } from './IconRail'
import { __resetShellStoreForTests, useShellStore } from './shellStore'

function fakeBridge(): AiwcBridge {
  return {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string) => {
      if (channel === 'substrate:status') return { connection: 'ready', account: { wxid: 'wxid_test', nickname: '张明' } }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

const mount = () => render(<TooltipProvider><IconRail mac /></TooltipProvider>)

beforeEach(() => {
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  __setBridgeForTests(fakeBridge())
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('IconRail', () => {
  it('marks the selected function with an accent-30 ring + indicator bar and no glow shadow', () => {
    mount()
    const chat = screen.getByRole('button', { name: '聊天' })
    const autoreply = screen.getByRole('button', { name: '自动回复' })
    expect(chat.getAttribute('aria-current')).toBe('page')
    expect(chat.dataset.active).toBe('true')
    expect(chat.style.boxShadow).toBe('')
    expect(chat.style.backgroundImage).toBe('var(--rail-tile-chat)')
    // 1px ring in the accent-30 token (CLAUDE.md §2.1: no drop-shadow glow, §2.2: selected = accent)
    expect(chat.className.split(' ')).toEqual(expect.arrayContaining(['ring-1', 'ring-accent-30']))
    expect(autoreply.getAttribute('aria-current')).toBeNull()
    expect(autoreply.className.split(' ')).toEqual(expect.arrayContaining(['ring-1', 'ring-line-10']))
    expect(autoreply.className).not.toContain('ring-accent-30')
    // tokens only: no arbitrary ring width, no raw white / black colours, and the icon is on-accent white
    for (const el of [chat, autoreply]) {
      expect(el.className).not.toMatch(/ring-\[|white|black|shadow/)
      expect(el.querySelector('svg')?.getAttribute('class')).toContain('text-(--fg-on-accent)')
    }
    // exactly one indicator bar, sitting next to the selected tile
    const bars = screen.getAllByTestId('rail-indicator')
    expect(bars).toHaveLength(1)
    expect(bars[0]?.parentElement?.contains(chat)).toBe(true)
    expect(bars[0]?.getAttribute('aria-hidden')).toBe('true')
  })

  it('dispatches rail.select and follows the store', () => {
    const select = vi.fn()
    const off = onCommand('rail.select', select)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'AI 克隆' }))
    expect(select).toHaveBeenCalledWith({ fn: 'clone' })
    act(() => useShellStore.getState().setRail('clone'))
    expect(screen.getByRole('button', { name: 'AI 克隆' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '聊天' }).getAttribute('aria-current')).toBeNull()
    off()
  })

  it('renders the account initial at the bubble size token (14px), never an arbitrary px', async () => {
    mount()
    const initial = await screen.findByText('张')
    expect(initial.parentElement?.className).toContain('text-bubble')
    expect(initial.className).not.toMatch(/text-\[\d/)
    const tile = screen.getByTestId('rail-account')
    expect(tile.getAttribute('aria-label')).toBe('张明 · 设置')
    expect(tile.dataset.active).toBeUndefined()
  })

  it('renders the WeChat avatar and refreshes it after a connection event', async () => {
    let listener: ((event: unknown) => void) | undefined
    let avatar = '/avatars/old.png'
    const bridge = fakeBridge()
    bridge.on = ((_channel: string, cb: (event: unknown) => void) => {
      listener = cb
      return () => {}
    }) as AiwcBridge['on']
    bridge.invoke = (async () => ({ connection: 'ready', account: { wxid: 'wxid_test', nickname: '张明', avatarPath: avatar } })) as AiwcBridge['invoke']
    __setBridgeForTests(bridge)
    mount()
    await screen.findByRole('button', { name: '张明 · 设置' })
    expect(screen.getByTestId('rail-account').querySelector('img')?.getAttribute('src')).toBe('aiwc-media:///avatars/old.png')
    await act(async () => {
      avatar = '/avatars/new.png'
      listener?.({ type: 'connection', state: 'ready' })
    })
    expect(screen.getByTestId('rail-account').querySelector('img')?.getAttribute('src')).toBe('aiwc-media:///avatars/new.png')
  })

  it('opens settings from the account tile and rings it while the settings tab is active', async () => {
    const open = vi.fn()
    const off = onCommand('tab.openSettings', open)
    mount()
    fireEvent.click(screen.getByTestId('rail-account'))
    expect(open).toHaveBeenCalledWith({})
    act(() => {
      useTabsStore.getState().open({ kind: 'settings', objectId: 'settings', title: '设置' })
    })
    expect(screen.getByTestId('rail-account').dataset.active).toBe('true')
    off()
  })
})
