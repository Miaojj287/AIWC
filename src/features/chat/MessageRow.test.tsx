// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { MessageRow } from './MessageRow'
const noop = () => {}
afterEach(cleanup)
it('renders pats as centered notices with no sender avatar or chat bubble', () => {
  const message = { id: 'pat', kind: 'system', text: '我拍了拍 "庄曼琦" 说你好👋🏻', isSelf: true } as WxMessage
  const { container } = render(<MessageRow message={message} isGroup selectMode={false} selected={false} focused={false} continued={false} mac onCopy={noop} onQuote={noop} onToggleSelect={noop} onJumpToTime={noop} onDeleteLocal={noop} onOpenImage={noop} />)
  expect(screen.getByText(message.text)).toBeTruthy()
  expect(container.querySelector('[data-message-id="pat"]')?.className).toContain('justify-center')
  expect(screen.queryByRole('img')).toBeNull()
  expect(container.querySelector('.bg-bubble-self')).toBeNull()
  expect(container.querySelector('time')).toBeNull()
})
