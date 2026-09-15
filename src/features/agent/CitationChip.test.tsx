// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WxMessage, WxSession } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { TooltipProvider } from '@/kit'
import { __resetCitationCacheForTests } from './citationResolver'
import { Markdown } from './MarkdownView'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const message: WxMessage = {
  id: 'wx:26442:1739500000000',
  sessionId: 'wxid_xw',
  seq: 1739500000000,
  createdAt: new Date(2026, 1, 14, 19, 28).getTime(),
  senderId: 'wxid_xw',
  senderName: '小吴',
  isSelf: false,
  kind: 'text',
  text: '你自己都说没有 yanda 你会和小吴纠缠一阵子',
  anchor: { sessionId: 'wxid_xw', messageId: 'wx:26442:1739500000000', seq: 1739500000000, createdAt: 0 },
}
const session = { id: 'wxid_xw', title: '小吴', kind: 'dm' } as unknown as WxSession
const href = 'wx://wxid_xw/wx:26442:1739500000000'

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

beforeEach(() => {
  __resetCitationCacheForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) =>
    channel === 'substrate:getMessage' ? message : channel === 'substrate:getSession' ? session : undefined,
  )
})
afterEach(cleanup)

const renderMd = (text: string) =>
  render(
    <TooltipProvider>
      <Markdown text={text} />
    </TooltipProvider>,
  )

describe('citation chips in Agent replies', () => {
  it('turns a wx:// link into a chip labelled sender · time and marks a verbatim quote', async () => {
    renderMd(`她说“没有 yanda 你会和小吴纠缠一阵子” [02-14 19:28](${href})`)
    expect(screen.getByRole('button', { name: /02-14 19:28/ })).toBeTruthy()
    await flush()
    const chip = screen.getByRole('button', { name: /小吴 · 02-14 19:28/ })
    expect(chip.getAttribute('data-verdict')).toBe('verbatim')
    expect(invokeMock).toHaveBeenCalledWith('substrate:getMessage', {
      sessionId: 'wxid_xw',
      messageId: 'wx:26442:1739500000000',
    })
  })

  it('flags a quote that is not in the cited message', async () => {
    renderMd(`> “你和小吴已经在一起了” [02-14 19:28](${href})`)
    await flush()
    expect(screen.getByRole('button', { name: /小吴/ }).getAttribute('data-verdict')).toBe('mismatch')
  })

  it('only checks the text since the previous citation', async () => {
    renderMd(`“编造的话” [a](${href}) 然后她说“纠缠一阵子” [b](${href})`)
    await flush()
    const chips = screen.getAllByRole('button')
    expect(chips.map((c) => c.getAttribute('data-verdict'))).toEqual(['mismatch', 'verbatim'])
  })

  it('shows a danger chip when the message is not in the local index', async () => {
    invokeMock.mockImplementation(async (channel) => (channel === 'substrate:getSession' ? session : undefined))
    renderMd(`看这里 [02-14 19:28](${href})`)
    await flush()
    const chip = screen.getByRole('button', { name: /02-14 19:28/ })
    expect(chip.getAttribute('data-verdict')).toBe('missing')
  })

  it('clicking the chip opens the chat tab focused on that message', async () => {
    const opened: unknown[] = []
    const off = onCommand('tab.openChat', (p) => opened.push(p))
    renderMd(`[02-14 19:28](${href})`)
    await flush()
    fireEvent.click(screen.getByRole('button'))
    expect(opened).toEqual([{ sessionId: 'wxid_xw', title: '小吴', focusMessageId: 'wx:26442:1739500000000' }])
    off()
  })

  it('leaves ordinary links alone', () => {
    renderMd('见 [文档](https://example.com/doc)')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('文档').getAttribute('title')).toBe('https://example.com/doc')
  })
})
