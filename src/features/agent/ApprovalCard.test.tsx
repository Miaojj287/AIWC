// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalId, CallId, TurnId } from '@aiwc/protocol'
import { APPROVAL_SCOPE_ATTR, ApprovalCard } from './ApprovalCard'
import { __resetCitationCacheForTests } from './citationResolver'
import { registerWeChatSendCards } from './messages/WeChatSendCards'
import type { ApprovalRequest } from './model'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

afterEach(cleanup)

const request: ApprovalRequest = {
  approvalId: 'apr_1' as ApprovalId,
  callId: 'c1' as CallId,
  turnId: 'trn_1' as TurnId,
  toolName: 'send_message',
  summary: '推送到 投研交流群',
  detail: '周报草稿 · 本周 6 个议题',
  input: { to: 'g2' },
  risk: 'send',
  canAllowAlways: true,
}

const list = () => screen.getByRole('listbox', { name: '确认选项' })
const option = (name: RegExp) => screen.getByRole('option', { name })
const confirm = () => screen.getByRole('button', { name: '确认' })

describe('<ApprovalCard> options', () => {
  it('lists 允许一次 · 总是允许 · 拒绝 · 拒绝并说明 with their number keys, 允许一次 selected', () => {
    render(<ApprovalCard request={request} onResolve={() => {}} />)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.getAttribute('data-decision'))).toEqual([
      'allow_once',
      'allow_always',
      'deny',
      'deny_reason',
    ])
    expect(options.map((o) => o.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4'])
    expect(option(/允许一次/).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('周报草稿 · 本周 6 个议题')).toBeTruthy()
  })

  it('hides 总是允许 when the tool cannot be allow-listed, and starts a destructive request on 拒绝', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={{ ...request, canAllowAlways: false, risk: 'destructive' }} onResolve={onResolve} />)
    expect(screen.queryByRole('option', { name: /总是允许/ })).toBeNull()
    expect(screen.getByText('此操作不可恢复，请确认。')).toBeTruthy()
    expect(option(/这次先拒绝/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list(), { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
  })

  it('selects on the first click and answers on a click of the selected option or 确认', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={request} onResolve={onResolve} />)
    fireEvent.click(option(/总是允许/))
    expect(onResolve).not.toHaveBeenCalled()
    expect(option(/总是允许/).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(option(/总是允许/))
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_always', { scope: 'thread' })
    fireEvent.click(option(/这次先拒绝/))
    fireEvent.click(confirm())
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
  })
})

describe('<ApprovalCard> 总是允许 scope and 拒绝并说明', () => {
  it('shows what 总是允许 allows and lets ←→ pick this chat or all chats', () => {
    const onResolve = vi.fn()
    render(
      <ApprovalCard request={{ ...request, toolName: 'shell', allowKey: 'shell:git commit' }} onResolve={onResolve} />,
    )
    expect(option(/总是允许/).textContent).toContain('以「git commit」开头的命令')
    fireEvent.keyDown(list(), { key: 'ArrowDown' })
    expect(screen.getByRole('radiogroup', { name: '放行范围' })).toBeTruthy()
    fireEvent.keyDown(list(), { key: 'ArrowRight' })
    fireEvent.keyDown(list(), { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_always', { scope: 'global' })
  })

  it('4 opens a note; ⏎ sends the denial with it, an empty note is refused, Esc goes back', () => {
    const onResolve = vi.fn()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    render(<ApprovalCard request={request} onResolve={onResolve} />)
    fireEvent.keyDown(list(), { key: '4' })
    const field = screen.getByRole('textbox', { name: '拒绝说明' })
    expect(onResolve).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByText('先写一句说明')).toBeTruthy()
    fireEvent.change(field, { target: { value: '改成只读预览' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(document.activeElement).toBe(list())
    expect(onResolve).not.toHaveBeenCalled()
    fireEvent.keyDown(list(), { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny', { reason: '改成只读预览' })
    vi.restoreAllMocks()
  })
})

describe('<ApprovalCard> keyboard scope', () => {
  it('ignores Enter, Escape and digits while focus is on a control outside the card', () => {
    const onResolve = vi.fn()
    render(
      <>
        <button type="button">取消</button>
        <ApprovalCard request={request} onResolve={onResolve} />
      </>,
    )
    const cancel = screen.getByRole('button', { name: '取消' })
    cancel.focus()
    // not handled and not default-prevented: the focused button keeps its own keys
    expect(fireEvent.keyDown(cancel, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(cancel, { key: 'Escape' })).toBe(true)
    expect(fireEvent.keyDown(cancel, { key: '1' })).toBe(true)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('takes focus when nothing is focused: digits answer, ↑↓ move, ⏎ confirms, Esc denies', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={request} onResolve={onResolve} />)
    expect(document.activeElement).toBe(list())
    expect(fireEvent.keyDown(list(), { key: 'Enter' })).toBe(false)
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_once')
    fireEvent.keyDown(list(), { key: '2' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_always', { scope: 'thread' })
    fireEvent.keyDown(list(), { key: 'ArrowUp' })
    fireEvent.keyDown(list(), { key: 'ArrowUp' })
    expect(option(/这次先拒绝/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list(), { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
    fireEvent.keyDown(list(), { key: 'ArrowDown' })
    fireEvent.keyDown(list(), { key: 'Escape' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
  })

  it('still hears the keys once focus has left for nowhere', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={request} onResolve={onResolve} />)
    list().blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_once')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
  })

  it('leaves Enter on the focused 确认 to the button itself', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={request} onResolve={onResolve} />)
    confirm().focus()
    expect(fireEvent.keyDown(confirm(), { key: 'Enter' })).toBe(true)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('a reference (non-primary) card neither takes focus nor listens for keys', () => {
    const onResolve = vi.fn()
    render(<ApprovalCard request={request} onResolve={onResolve} primary={false} />)
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.keyDown(document.body, { key: '1' })
    expect(onResolve).not.toHaveBeenCalled()
    expect(option(/允许一次/).getAttribute('aria-keyshortcuts')).toBeNull()
  })
})

describe('<ApprovalCard> focus', () => {
  it('keeps the caret in a field elsewhere and leaves its keys alone', () => {
    const onResolve = vi.fn()
    const { rerender } = render(<textarea aria-label="搜索" />)
    const field = screen.getByRole('textbox', { name: '搜索' })
    field.focus()
    rerender(
      <>
        <textarea aria-label="搜索" />
        <ApprovalCard request={request} onResolve={onResolve} />
      </>,
    )
    expect(document.activeElement).toBe(field)
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('moves focus onto the options when it was left in the slot it shares with the composer', () => {
    const scope = { [APPROVAL_SCOPE_ATTR]: '' }
    const { rerender } = render(
      <div {...scope}>
        <textarea aria-label="给 Agent 的消息" />
      </div>,
    )
    screen.getByRole('textbox', { name: '给 Agent 的消息' }).focus()
    rerender(
      <div {...scope}>
        <ApprovalCard request={request} onResolve={() => {}} />
        <div hidden>
          <textarea aria-label="给 Agent 的消息" />
        </div>
      </div>,
    )
    expect(document.activeElement).toBe(list())
  })

  it('is a labelled group, not an alert dialog', () => {
    render(<ApprovalCard request={request} onResolve={() => {}} queued={2} />)
    const card = screen.getByRole('group', { name: 'Agent 请求：推送到 投研交流群' })
    expect(card.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('还有 2 个待确认')).toBeTruthy()
    expect(confirm().getAttribute('aria-keyshortcuts')).toBe('Enter')
  })
})

describe('<ApprovalCard> for a WeChat send', () => {
  it('shows who receives which bubbles instead of the raw input', async () => {
    __resetCitationCacheForTests()
    invokeMock.mockImplementation(async (channel) =>
      channel === 'substrate:getSession' ? { id: 'g2@chatroom', title: '投研交流群', kind: 'group' } : undefined,
    )
    const unregister = registerWeChatSendCards()
    try {
      const input = { to: 'g2@chatroom', text: '周报草稿已整理好\n---wx-next---\n今晚 8 点前请过目' }
      render(<ApprovalCard request={{ ...request, input }} onResolve={() => {}} />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByRole('button', { name: '投研交流群' })).toBeTruthy()
      expect(screen.getByText('群聊')).toBeTruthy()
      expect(screen.getByText('g2@chatroom')).toBeTruthy()
      const bubbles = within(screen.getByRole('list', { name: '消息内容' })).getAllByRole('listitem')
      expect(bubbles.map((b) => b.textContent)).toEqual(['周报草稿已整理好', '今晚 8 点前请过目'])
      expect(screen.getByText('将发送 2 条')).toBeTruthy()
      expect(screen.getByText('将以你的微信身份发送，发出后无法撤回。')).toBeTruthy()
      expect(screen.queryByText(/wx-next|"to"/)).toBeNull()
      expect(screen.getAllByRole('option')).toHaveLength(4)
    } finally {
      unregister()
    }
  })
})
