// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnId } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { UserMessage, type UserItem } from './UserMessage'

afterEach(cleanup)

const item: UserItem = {
  kind: 'user',
  id: 'u1',
  turnId: 't1' as TurnId,
  content: [
    { type: 'text', text: '看看这张图' },
    { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'shot.png' },
  ],
  mentions: [],
}

describe('<UserMessage> attachments', () => {
  it('shows attachments as tiles, not placeholder text, and resends them', () => {
    const onResend = vi.fn()
    render(
      <TooltipProvider>
        <UserMessage item={item} onResend={onResend} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy()
    expect(screen.getByText('看看这张图')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }))
    expect(onResend).toHaveBeenCalledWith('看看这张图', [], [expect.objectContaining({ part: item.content[1] })])
  })
})
