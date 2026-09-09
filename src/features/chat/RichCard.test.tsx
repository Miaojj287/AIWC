// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RichCard } from './RichCard'
import { openUrl } from '@/platform/openExternal'
vi.mock('@/platform/openExternal', () => ({ openUrl: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('opens the article URL when its card is clicked', () => {
  render(<RichCard rich={{ type: 'article', title: '腾讯游戏文章', source: '腾讯游戏', coverUrl: 'https://example.com/cover.jpg', url: 'https://mp.weixin.qq.com/s?a=1&b=2' }} />)
  fireEvent.click(screen.getByRole('button', { name: '打开腾讯游戏文章' }))
  expect(openUrl).toHaveBeenCalledWith('https://mp.weixin.qq.com/s?a=1&b=2')
  expect(screen.getByText('腾讯游戏 · 公众号图文')).toBeTruthy()
})
it('each article in a push opens its own URL', () => {
  render(<RichCard rich={{ type: 'article', title: '合集', entries: [{ title: '第一篇', url: 'https://example.com/1' }, { title: '第二篇', url: 'https://example.com/2' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: '打开第二篇' }))
  expect(openUrl).toHaveBeenCalledWith('https://example.com/2')
})
it('does not make an unsafe URL clickable', () => {
  render(<RichCard rich={{ type: 'link', title: '测试', url: 'javascript:alert(1)' }} />)
  expect(screen.queryByRole('button')).toBeNull()
})
it('opens forwarded chat content in a dialog', () => {
  render(<RichCard rich={{ type: 'chatHistory', title: '群聊的聊天记录', entries: [{ title: '小王', description: '下次见' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: '查看群聊的聊天记录' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByText('下次见')).toBeTruthy()
})
