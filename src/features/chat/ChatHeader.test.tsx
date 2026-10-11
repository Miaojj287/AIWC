import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WxSession } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { t } from '@/i18n'
import { ChatHeader } from './ChatHeader'

afterEach(cleanup)

const session: WxSession = {
  id: 'test-session',
  kind: 'dm',
  title: 'Test contact',
  unread: 0,
  pinned: false,
  muted: false,
}

function mount(loaded = true) {
  const actions = {
    onSearch: vi.fn(),
    onExport: vi.fn(),
    onAutoReply: vi.fn(),
    onClone: vi.fn(),
    onRebuildIndex: vi.fn(),
    onRemoveIndex: vi.fn(),
    onQuoteSession: vi.fn(),
  }
  render(
    <TooltipProvider>
      <ChatHeader session={loaded ? session : undefined} meta="" counts={undefined} mac {...actions} />
    </TooltipProvider>,
  )
  return actions
}

describe('ChatHeader quick actions', () => {
  it('opens search and export directly without opening the overflow menu', () => {
    const actions = mount()
    fireEvent.click(screen.getByRole('button', { name: t('chat.header.menu.search') }))
    fireEvent.click(screen.getByRole('button', { name: t('chat.header.menu.export') }))
    expect(actions.onSearch).toHaveBeenCalledOnce()
    expect(actions.onExport).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not dispatch quick actions before the session is loaded', () => {
    const actions = mount(false)
    fireEvent.click(screen.getByRole('button', { name: t('chat.header.menu.search') }))
    fireEvent.click(screen.getByRole('button', { name: t('chat.header.menu.export') }))
    expect(actions.onSearch).not.toHaveBeenCalled()
    expect(actions.onExport).not.toHaveBeenCalled()
  })
})
