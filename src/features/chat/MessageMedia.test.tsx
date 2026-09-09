// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { ImageBody } from './MessageMedia'

vi.mock('@/platform/hooks', () => ({ invoke: vi.fn(async () => ({ kind: 'image', path: '/full.png', thumbPath: '/thumb.png' })) }))
afterEach(cleanup)
it('falls back from a broken thumbnail to the original and stops after both fail', async () => {
  const message = { id: '1', sessionId: 's', kind: 'image' } as WxMessage
  render(<ImageBody message={message} onOpen={() => {}} />)
  const img = await screen.findByRole('img', { name: '图片' })
  expect(img.getAttribute('src')).toBe('aiwc-media:///thumb.png')
  fireEvent.error(img)
  expect(img.getAttribute('src')).toBe('aiwc-media:///full.png')
  fireEvent.error(img)
  expect(screen.queryByRole('img', { name: '图片' })).toBeNull()
  expect(screen.getByText('图片不可用')).toBeTruthy()
})
