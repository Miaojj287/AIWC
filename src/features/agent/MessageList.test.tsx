// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalId, CallId, TurnId } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { MessageList } from './MessageList'
import type { ApprovalRequest, ThreadItem } from './model'
import { patchJsdomTopLayerMatches } from './testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(cleanup)

const turnId = 'trn_1' as TurnId

const items: ThreadItem[] = [
  { kind: 'user', id: 'u1', turnId, content: [{ type: 'text', text: '帮我总结「产品市场群」今天的讨论' }], mentions: [{ kind: 'session', id: 's1', label: '产品市场群' }] },
  { kind: 'assistant', id: 'a1', turnId, text: '好的，我先读取该群今天的消息。', streaming: false, durationMs: 3200, modelId: 'demo' },
  {
    kind: 'tools',
    id: 't1',
    turnId,
    calls: [
      { callId: 'c1' as CallId, toolName: 'read_session', summary: '读取 产品市场群 · 今日 128 条消息', status: 'done', risk: 'read', input: { chat: 's1' }, output: { total: 128 }, startedAt: 0, durationMs: 800 },
      { callId: 'c2' as CallId, toolName: 'send_message', summary: '推送到 投研交流群', status: 'awaiting_approval', risk: 'send', input: { to: 'g2' }, startedAt: 0, approvalId: 'apr_1' as ApprovalId },
    ],
  },
  { kind: 'artifact', id: 'art1', turnId, callId: 'c1' as CallId, artifact: { kind: 'file', title: '周报草稿.md', path: '/tmp/周报草稿.md' } },
  { kind: 'compaction', id: 'cmp1', freedTokens: 58_000 },
  { kind: 'plan', id: 'p1', turnId, steps: [{ title: '搜索', status: 'done' }, { title: '整理', status: 'doing' }] },
  { kind: 'error', id: 'e1', turnId, error: { code: 'auth', message: 'API Key 无效或已过期', retryable: false }, actions: [{ label: '去改 Key', action: 'open_settings_ai' }, { label: '重试', action: 'retry' }] },
  { kind: 'aborted', id: 'ab1', turnId, reason: 'interrupted' },
]

const approval: ApprovalRequest = { approvalId: 'apr_1' as ApprovalId, callId: 'c2' as CallId, turnId, toolName: 'send_message', summary: '推送到 投研交流群', detail: '周报草稿 · 本周 6 个议题', input: { to: 'g2' }, risk: 'send', canAllowAlways: true }

describe('<MessageList>', () => {
  it('renders every item kind with its copy', () => {
    render(<MessageList items={items} pendingApprovals={[]} modelLabel="演示模型" />)
    expect(screen.getByText('帮我总结「产品市场群」今天的讨论')).toBeTruthy()
    expect(screen.getByText('好的，我先读取该群今天的消息。')).toBeTruthy()
    expect(screen.getByText('读取 产品市场群 · 今日 128 条消息')).toBeTruthy()
    expect(screen.getByText('0.8s')).toBeTruthy()
    expect(screen.getByText('等待确认')).toBeTruthy()
    expect(screen.getByText('周报草稿.md')).toBeTruthy()
    expect(screen.getByText('已在中间标签页打开 · 可直接编辑')).toBeTruthy()
    expect(screen.getByText('上下文已压缩 · 释放 58k tokens')).toBeTruthy()
    expect(screen.getByText('模型请求失败')).toBeTruthy()
    expect(screen.getByText('已停止生成')).toBeTruthy()
    expect(screen.getByText('· 演示模型 · 3.2s')).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('expands a tool row to show input / output JSON', () => {
    render(<MessageList items={items} />)
    fireEvent.click(screen.getByText('读取 产品市场群 · 今日 128 条消息'))
    expect(screen.getByText('输入')).toBeTruthy()
    expect(screen.getByText(/"chat": "s1"/)).toBeTruthy()
    expect(screen.getByText(/"total": 128/)).toBeTruthy()
  })

  it('renders the approval inline under the awaiting row and resolves it', () => {
    const onResolve = vi.fn()
    render(<MessageList items={items} pendingApprovals={[approval]} onResolveApproval={onResolve} />)
    const card = screen.getByTestId('approval-card')
    expect(screen.getByText('Agent 请求：推送到 投研交流群')).toBeTruthy()
    expect(screen.getByText('周报草稿 · 本周 6 个议题')).toBeTruthy()
    // inline, inside the tool-call group — not portalled out to the document body
    expect(card.closest('[data-item="tools"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(onResolve).toHaveBeenCalledWith('apr_1', 'allow_once')
    fireEvent.click(screen.getByRole('button', { name: '总是允许' }))
    expect(onResolve).toHaveBeenCalledWith('apr_1', 'allow_always')
  })

  it('the pending approval takes ⏎ / ⇧⏎ / Esc', () => {
    const onResolve = vi.fn()
    render(<MessageList items={items} pendingApprovals={[approval]} onResolveApproval={onResolve} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_once')
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'allow_always')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onResolve).toHaveBeenLastCalledWith('apr_1', 'deny')
  })

  it('while an approval is open the turn reads as paused, not generating', () => {
    render(<MessageList items={items} streaming turnStartedAt={Date.now() - 4100} pendingApprovals={[approval]} onResolveApproval={() => {}} />)
    expect(screen.getByText('已暂停，等待你确认上面的操作')).toBeTruthy()
    expect(screen.queryByText(/正在生成/)).toBeNull()
  })

  it('hides 总是允许 when the tool cannot be allow-listed', () => {
    render(<MessageList items={items} pendingApprovals={[{ ...approval, canAllowAlways: false, risk: 'destructive' }]} onResolveApproval={() => {}} />)
    expect(screen.queryByRole('button', { name: '总是允许' })).toBeNull()
    expect(screen.getByText('此操作不可恢复，请确认。')).toBeTruthy()
  })

  it('dispatches error actions: settings command and retry through onResend', () => {
    const openSettings = vi.fn()
    const off = onCommand('tab.openSettings', openSettings)
    const onResend = vi.fn()
    render(<MessageList items={items} onResend={onResend} />)
    fireEvent.click(screen.getByRole('button', { name: '去改 Key' }))
    expect(openSettings).toHaveBeenCalledWith({ page: 'ai' })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onResend).toHaveBeenCalledWith('帮我总结「产品市场群」今天的讨论', [{ kind: 'session', id: 's1', label: '产品市场群' }])
    off()
  })

  it('opens the artifact in a workspace tab', () => {
    const openFile = vi.fn()
    const off = onCommand('tab.openFile', openFile)
    render(<MessageList items={items} />)
    fireEvent.click(screen.getByText('周报草稿.md'))
    expect(openFile).toHaveBeenCalledWith({ path: '/tmp/周报草稿.md', title: '周报草稿.md' })
    off()
  })

  it('shows the empty thread with suggestions, and the streaming indicator with 停止生成', () => {
    const onSuggestion = vi.fn()
    const { unmount } = render(<MessageList items={[]} suggestions={['总结今天的产品市场群', '找发票']} onSuggestion={onSuggestion} />)
    expect(screen.getByText('新会话')).toBeTruthy()
    fireEvent.click(screen.getByText('总结今天的产品市场群'))
    expect(onSuggestion).toHaveBeenCalledWith('总结今天的产品市场群')
    unmount()
    const onStop = vi.fn()
    render(<MessageList items={[items[0]!]} streaming turnStartedAt={Date.now() - 4100} onStop={onStop} />)
    expect(screen.getByText(/正在生成 · 已用/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(onStop).toHaveBeenCalled()
  })
})
