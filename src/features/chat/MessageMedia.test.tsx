// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { clearToasts, getToasts } from '@/kit'
import { invoke } from '@/platform/hooks'
import { FileBody, ImageBody } from './MessageMedia'

vi.mock('@/platform/hooks', () => ({
  invoke: vi.fn(async () => ({ kind: 'image', path: '/full.png', thumbPath: '/thumb.png' })),
}))
afterEach(() => {
  cleanup()
  clearToasts()
})
it('falls back from a broken thumbnail to the original and stops after both fail', async () => {
  const message = { id: '1', sessionId: 's', kind: 'image' } as WxMessage
  render(<ImageBody message={message} onOpen={() => {}} />)
  const img = await screen.findByRole('img', { name: '图片' })
  expect(img.getAttribute('src')).toBe('aiwc-media:///thumb.png')
  fireEvent.error(img)
  expect(img.getAttribute('src')).toBe('aiwc-media:///full.png')
  fireEvent.error(img)
  expect(screen.queryByRole('img', { name: '图片' })).toBeNull()
  expect(screen.getByText('图片加载失败 · 点击重试')).toBeTruthy()
  const calls = vi.mocked(invoke).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '重新加载图片' }))
  expect(await screen.findByRole('img', { name: '图片' })).toBeTruthy()
  expect(vi.mocked(invoke).mock.calls.length).toBe(calls + 1)
})

it('tells the user when a file attachment cannot be opened instead of failing silently', async () => {
  vi.mocked(invoke).mockImplementationOnce(async () => undefined)
  const message = { id: 'f1', sessionId: 's', kind: 'file', media: { fileName: 'report.pdf' } } as WxMessage
  render(<FileBody message={message} self={false} />)
  fireEvent.click(screen.getByRole('button', { name: /report\.pdf/ }))
  await waitFor(() => expect(getToasts().some((toast) => toast.kind === 'error')).toBe(true))
})

it('plays sticker originals first and uses a local thumbnail if the original fails', async () => {
  render(
    <ImageBody message={{ id: 'sticker', sessionId: 's', kind: 'sticker' } as WxMessage} sticker onOpen={() => {}} />,
  )
  const img = await screen.findByRole('img', { name: '表情' })
  expect(img.getAttribute('src')).toBe('aiwc-media:///full.png')
  fireEvent.error(img)
  expect(img.getAttribute('src')).toBe('aiwc-media:///thumb.png')
})
