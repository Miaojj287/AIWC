// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalId, CallId, JsonValue, TurnId, WxSession } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { __resetCitationCacheForTests } from '../citationResolver'
import type { ApprovalRequest, ToolCallView } from '../model'
import { WeChatSendApprovalBody, WeChatSendCard } from './WeChatSendCards'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const chat = (s: Pick<WxSession, 'id' | 'title' | 'kind'> & Partial<WxSession>): WxSession => ({
  unread: 0,
  pinned: false,
  muted: false,
  ...s,
})
const SESSIONS: Record<string, WxSession> = {
  wxid_peer1: chat({ id: 'wxid_peer1', title: '林小雨', kind: 'dm' }),
  'team01@chatroom': chat({ id: 'team01@chatroom', title: '产品周会群', kind: 'group', memberCount: 12 }),
}

const ask = (toolName: string, input: JsonValue): ApprovalRequest => ({
  approvalId: 'apr_1' as ApprovalId,
  callId: 'c1' as CallId,
  turnId: 'trn_1' as TurnId,
  toolName,
  summary: 'send',
  input,
  risk: 'send',
  canAllowAlways: false,
})

const ran = (
  toolName: string,
  input: JsonValue,
  status: ToolCallView['status'],
  output?: ToolCallView['output'],
): ToolCallView => ({
  callId: 'c1' as CallId,
  toolName,
  summary: 'send',
  status,
  risk: 'send',
  input,
  output,
  isError: status === 'error' || status === 'denied' ? true : undefined,
  startedAt: 0,
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

const bubbles = () => within(screen.getByRole('list', { name: '消息内容' })).getAllByRole('listitem')

beforeEach(() => {
  __resetCitationCacheForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel, req) =>
    channel === 'substrate:getSession' ? SESSIONS[(req as { id: string }).id] : undefined,
  )
})
afterEach(() => {
  cleanup()
  __resetLanguageForTests()
})

describe('WeChat send preview: recipient', () => {
  it('names the chat from the local records, marks it 单聊 and keeps the raw id', async () => {
    const open = vi.fn()
    const off = onCommand('tab.openChat', open)
    render(<WeChatSendApprovalBody request={ask('send_message', { to: 'wxid_peer1', text: '好的，马上到' })} />)
    await flush()
    expect(invokeMock).toHaveBeenCalledWith('substrate:getSession', { id: 'wxid_peer1' })
    expect(screen.getByText('单聊')).toBeTruthy()
    expect(screen.getByText('wxid_peer1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '林小雨' }))
    expect(open).toHaveBeenCalledWith({ sessionId: 'wxid_peer1', title: '林小雨' })
    off()
  })

  it('marks a group chat 群聊 with its member count', async () => {
    render(<WeChatSendApprovalBody request={ask('send_message', { to: 'team01@chatroom', text: '收到' })} />)
    await flush()
    expect(screen.getByRole('button', { name: '产品周会群' })).toBeTruthy()
    expect(screen.getByText('群聊')).toBeTruthy()
    expect(screen.getByText('12 人')).toBeTruthy()
  })

  it('warns about a chat missing from the local records and still tells a group id by its suffix', async () => {
    render(<WeChatSendApprovalBody request={ask('send_message', { to: '5566@im.chatroom', text: '收到' })} />)
    await flush()
    expect(screen.getByText('本机记录里没有这个会话，请核对 ID。')).toBeTruthy()
    expect(screen.getByText('群聊')).toBeTruthy()
    expect(screen.getByText('5566@im.chatroom')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says so when the lookup itself fails', async () => {
    invokeMock.mockRejectedValue(new Error('substrate offline'))
    render(<WeChatSendApprovalBody request={ask('send_message', { to: 'wxid_peer1', text: '收到' })} />)
    await flush()
    expect(screen.getByText('暂时读不到本机的会话信息，请核对 ID。')).toBeTruthy()
    expect(screen.getByText('wxid_peer1')).toBeTruthy()
  })

  it('warns when no recipient was given instead of showing the raw input', () => {
    render(<WeChatSendApprovalBody request={ask('send_message', { text: '收到' })} />)
    expect(screen.getByText('没有指定接收会话，无法确认发给谁。')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/"text"/)).toBeNull()
  })
})

describe('WeChat send preview: content', () => {
  it('splits the text into bubbles exactly where the sender will, with a count', async () => {
    render(
      <WeChatSendApprovalBody
        request={ask('send_message', {
          to: 'wxid_peer1',
          text: '第一条\n---wx-next---\n第二条\n  第二条第二行\n---wx-next---\n第三条 ---wx-next--- 第四条',
        })}
      />,
    )
    await flush()
    expect(bubbles().map((b) => b.textContent)).toEqual(['第一条', '第二条\n  第二条第二行', '第三条', '第四条'])
    expect(screen.getByText('将发送 4 条')).toBeTruthy()
    expect(screen.queryByText(/wx-next/)).toBeNull()
  })

  it('shows no count for a single bubble', async () => {
    render(<WeChatSendApprovalBody request={ask('send_message', { to: 'wxid_peer1', text: '好的' })} />)
    await flush()
    expect(bubbles()).toHaveLength(1)
    expect(screen.queryByText(/将发送/)).toBeNull()
  })

  it('previews send_media: kind, file name, full path and the caption bubble', async () => {
    const path = '/Users/me/Exports/季度报告.pdf'
    render(
      <WeChatSendApprovalBody
        request={ask('send_media', { kind: 'file', path, caption: '请查收', to: 'wxid_peer1' })}
      />,
    )
    await flush()
    expect(screen.getByText('文件')).toBeTruthy()
    expect(screen.getByText('季度报告.pdf')).toBeTruthy()
    expect(screen.getByText(path).getAttribute('title')).toBe(path)
    expect(bubbles().map((b) => b.textContent)).toEqual([expect.stringContaining('季度报告.pdf'), '请查收'])
    expect(screen.getByText('将发送 2 条')).toBeTruthy()
    expect(screen.queryByRole('img', { name: '季度报告.pdf' })).toBeNull()
  })

  it('shows a thumbnail for an image and drops it when the file cannot be shown', async () => {
    render(
      <WeChatSendApprovalBody
        request={ask('send_media', { kind: 'image', path: '/Users/me/Pictures/cat.png', to: 'wxid_peer1' })}
      />,
    )
    await flush()
    expect(screen.getByText('图片')).toBeTruthy()
    const thumb = screen.getByRole('img', { name: 'cat.png' })
    expect(thumb.getAttribute('src')).toBe('aiwc-media:///Users/me/Pictures/cat.png')
    fireEvent.error(thumb)
    expect(screen.queryByRole('img', { name: 'cat.png' })).toBeNull()
    expect(screen.getByText('cat.png')).toBeTruthy()
  })

  it('falls back to the raw input it cannot read rather than showing nothing', () => {
    render(<WeChatSendApprovalBody request={ask('send_media', { kind: 'sticker', path: '/tmp/x' })} />)
    expect(screen.getByText(/"sticker"/)).toBeTruthy()
  })
})

describe('WeChat send result in the expanded tool row', () => {
  it('reports a verified send', async () => {
    const output = { ok: true, to: 'wxid_peer1', channel: 'wechat-ui', messageId: 'm1', verified: true, error: null }
    render(<WeChatSendCard call={ran('send_message', { to: 'wxid_peer1', text: '好的' }, 'done', output)} />)
    await flush()
    expect(screen.getByRole('button', { name: '林小雨' })).toBeTruthy()
    expect(screen.getByText('已发送')).toBeTruthy()
    expect(screen.getByText('已在聊天记录里核对')).toBeTruthy()
  })

  it('reports a failure with the tool error, translated when the UI is English', async () => {
    const output = { ok: false, to: 'wxid_peer1', channel: 'wechat-ui', error: 'UI 注入通道只支持文本' }
    const call = ran('send_media', { kind: 'image', path: '/tmp/a.png', to: 'wxid_peer1' }, 'error', output)
    const { rerender } = render(<WeChatSendCard call={call} />)
    await flush()
    expect(screen.getByText('发送失败')).toBeTruthy()
    expect(screen.getByText('UI 注入通道只支持文本')).toBeTruthy()
    act(() => setLanguage('en-US'))
    rerender(<WeChatSendCard call={call} />)
    expect(screen.getByText('Send failed')).toBeTruthy()
    expect(screen.getByText('The UI injection channel supports text only')).toBeTruthy()
  })

  it('keeps the missing-recipient warning next to the refusal the tool gave', () => {
    const output = { ok: false, error: '请指定接收会话 to（微信会话 id）' }
    const call = ran('send_message', { text: '收到' }, 'error', output)
    render(<WeChatSendCard call={call} />)
    expect(screen.getByText('没有指定接收会话，无法确认发给谁。')).toBeTruthy()
    expect(screen.getByText('请指定接收会话 to（微信会话 id）')).toBeTruthy()
    act(() => setLanguage('en-US'))
    expect(screen.getByText('No recipient was given, so who receives this is unclear.')).toBeTruthy()
    expect(screen.getByText('Specify the recipient chat as "to" (a WeChat chat ID)')).toBeTruthy()
  })

  it('names the chat the tool actually sent to, even when the input had none', async () => {
    const output = { ok: true, to: 'team01@chatroom', channel: 'wechat-ilink', verified: null }
    render(<WeChatSendCard call={ran('send_message', { text: '收到' }, 'done', output)} />)
    await flush()
    expect(screen.getByRole('button', { name: '产品周会群' })).toBeTruthy()
    expect(screen.queryByText('没有指定接收会话，无法确认发给谁。')).toBeNull()
    expect(screen.queryByText('已在聊天记录里核对')).toBeNull()
  })

  it('says nothing was sent when the approval was denied, and asks to check WeChat after a timeout', async () => {
    const input = { to: 'wxid_peer1', text: '好的' }
    const { rerender } = render(<WeChatSendCard call={ran('send_message', input, 'denied')} />)
    await flush()
    expect(screen.getByText('已拒绝，没有发送')).toBeTruthy()
    rerender(<WeChatSendCard call={ran('send_message', input, 'timeout')} />)
    expect(screen.getByText('发送超时，请到微信里确认是否已发出。')).toBeTruthy()
    rerender(<WeChatSendCard call={ran('send_message', input, 'running')} />)
    expect(screen.queryByText('已发送')).toBeNull()
    expect(bubbles()).toHaveLength(1)
  })

  it('labels draft_reply as a draft in the reply desk and opens it', async () => {
    const open = vi.fn()
    const off = onCommand('tab.openReplyDesk', open)
    const output = { drafted: true, text: '晚点回你', to: 'wxid_peer1', note: '…' }
    render(<WeChatSendCard call={ran('draft_reply', { to: 'wxid_peer1', text: '晚点回你' }, 'done', output)} />)
    await flush()
    expect(screen.getByText('已放入回复台')).toBeTruthy()
    expect(screen.getByText('在回复台确认后才会发出。')).toBeTruthy()
    expect(screen.queryByText('已发送')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开回复台' }))
    expect(open).toHaveBeenCalled()
    off()
  })

  it('speaks English with plural counts', async () => {
    setLanguage('en-US')
    render(
      <WeChatSendApprovalBody
        request={ask('send_message', { to: 'team01@chatroom', text: 'one\n---wx-next---\ntwo' })}
      />,
    )
    await flush()
    expect(screen.getByText('Will send 2 messages')).toBeTruthy()
    expect(screen.getByText('Group chat')).toBeTruthy()
    expect(screen.getByText('12 members')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Message content' })).toBeTruthy()
  })
})
