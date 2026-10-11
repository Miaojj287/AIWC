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
const AT = Date.UTC(2026, 8, 27, 2, 0, 0)

it('keeps reasoning-only history available without mixing it into the answer', () => {
  render(
    <MessageList
      items={[
        {
          kind: 'assistant',
          id: 'thought',
          turnId,
          text: '',
          reasoning: 'Check the source dates first.',
          streaming: false,
        },
      ]}
    />,
  )
  const toggle = screen.getByRole('button', { name: '已思考' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Check the source dates first.')).toBeNull()
  fireEvent.click(toggle)
  expect(screen.getByText('Check the source dates first.')).toBeTruthy()
  fireEvent.click(toggle)
  expect(screen.queryByText('Check the source dates first.')).toBeNull()
  expect(screen.queryByRole('button', { name: '复制' })).toBeNull()
})

it('reports thinking only while reasoning is streaming and changes to replying with answer text', () => {
  const thought: ThreadItem = {
    kind: 'assistant',
    id: 'thought',
    turnId,
    text: '',
    reasoning: 'Check source dates.',
    streaming: true,
  }
  const { rerender } = render(<MessageList items={[thought]} streaming />)
  expect(screen.getByRole('status').textContent).toContain('正在思考')
  fireEvent.click(screen.getByRole('button', { name: '正在思考' }))
  rerender(<MessageList items={[{ ...thought, text: 'Here is the answer.' }]} streaming />)
  expect(screen.getByRole('status').textContent).toContain('正在回复')
  expect(screen.getByRole('button', { name: '已思考' }).getAttribute('aria-expanded')).toBe('true')
})

it('identifies the historical user prompt separately from the assistant response', () => {
  render(<MessageList items={items.slice(0, 2)} />)
  const prompt = screen.getByRole('article', { name: '你' })
  expect(prompt.textContent).toContain('帮我总结「产品市场群」今天的讨论')
  expect(prompt.textContent).not.toContain('好的，我先读取该群今天的消息。')
})

it('keeps tool execution and approval visible independently of reasoning', () => {
  const tools = items.find((item) => item.kind === 'tools')!
  if (tools.kind !== 'tools') throw new Error('Missing tools fixture')
  const running: ThreadItem = { ...tools, calls: tools.calls.map((call) => ({ ...call, status: 'running' })) }
  const { rerender } = render(<MessageList items={[running]} streaming />)
  expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('正在执行工具'))).toBe(true)
  expect(screen.getByText('读取 产品市场群 · 今日 128 条消息')).toBeTruthy()
  rerender(<MessageList items={[tools]} streaming pendingApprovals={[approval]} />)
  expect(screen.getByRole('status').textContent).toContain('等待你在下方确认')
})

const items: ThreadItem[] = [
  {
    kind: 'user',
    id: 'u1',
    turnId,
    content: [{ type: 'text', text: '帮我总结「产品市场群」今天的讨论' }],
    mentions: [{ kind: 'session', id: 's1', label: '产品市场群' }],
    createdAt: AT,
  },
  {
    kind: 'assistant',
    id: 'a1',
    turnId,
    text: '好的，我先读取该群今天的消息。',
    streaming: false,
    durationMs: 3200,
    modelId: 'demo',
  },
  {
    kind: 'tools',
    id: 't1',
    turnId,
    calls: [
      {
        callId: 'c1' as CallId,
        toolName: 'read_session',
        summary: '读取 产品市场群 · 今日 128 条消息',
        status: 'done',
        risk: 'read',
        input: { chat: 's1' },
        output: { total: 128 },
        startedAt: 0,
        durationMs: 800,
      },
      {
        callId: 'c2' as CallId,
        toolName: 'send_message',
        summary: '推送到 投研交流群',
        status: 'awaiting_approval',
        risk: 'send',
        input: { to: 'g2' },
        startedAt: 0,
        approvalId: 'apr_1' as ApprovalId,
      },
    ],
  },
  {
    kind: 'artifact',
    id: 'art1',
    turnId,
    callId: 'c1' as CallId,
    artifact: { kind: 'file', title: '周报草稿.md', path: '/tmp/周报草稿.md' },
  },
  { kind: 'compaction', id: 'cmp1', freedTokens: 58_000 },
  {
    kind: 'plan',
    id: 'p1',
    turnId,
    steps: [
      { title: '搜索', status: 'done' },
      { title: '整理', status: 'doing' },
    ],
  },
  {
    kind: 'error',
    id: 'e1',
    turnId,
    error: { code: 'auth', message: 'API Key 无效或已过期', retryable: false },
    actions: [
      { label: '去改 Key', action: 'open_settings_ai' },
      { label: '重试', action: 'retry' },
    ],
  },
  { kind: 'aborted', id: 'ab1', turnId, reason: 'interrupted' },
]

const approval: ApprovalRequest = {
  approvalId: 'apr_1' as ApprovalId,
  callId: 'c2' as CallId,
  turnId,
  toolName: 'send_message',
  summary: '推送到 投研交流群',
  detail: '周报草稿 · 本周 6 个议题',
  input: { to: 'g2' },
  risk: 'send',
  canAllowAlways: true,
}

describe('<MessageList>', () => {
  it('renders every item kind with its copy', () => {
    render(<MessageList items={items} pendingApprovals={[]} modelLabel="演示模型" />)
    expect(screen.getByText('帮我总结「产品市场群」今天的讨论')).toBeTruthy()
    expect(screen.getByText('好的，我先读取该群今天的消息。')).toBeTruthy()
    expect(screen.getByText('读取 产品市场群 · 今日 128 条消息')).toBeTruthy()
    expect(screen.getByText('0.8s')).toBeTruthy()
    expect(screen.getByText('等待确认')).toBeTruthy()
    expect(screen.getByText('周报草稿.md')).toBeTruthy()
    expect(screen.getByText('点按在工作区打开')).toBeTruthy()
    expect(screen.getByText('上下文已压缩 · 释放 58k tokens')).toBeTruthy()
    expect(screen.getByText('模型请求失败')).toBeTruthy()
    expect(screen.getByText('已停止生成')).toBeTruthy()
    expect(screen.getByText('演示模型')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
  })

  it('expands a tool row to show input / output JSON', () => {
    render(<MessageList items={items} />)
    fireEvent.click(screen.getByText('读取 产品市场群 · 今日 128 条消息'))
    expect(screen.getByText('输入')).toBeTruthy()
    expect(screen.getByText(/"chat": "s1"/)).toBeTruthy()
    expect(screen.getByText(/"total": 128/)).toBeTruthy()
  })

  it('marks the awaiting row and leaves answering to the composer slot', () => {
    render(<MessageList items={items} streaming pendingApprovals={[approval]} />)
    expect(screen.getByText('等待确认')).toBeTruthy()
    expect(screen.queryByTestId('approval-card')).toBeNull()
    expect(screen.queryByRole('button', { name: '允许一次' })).toBeNull()
  })

  it('while an approval is open the turn reads as paused, without a spinner', () => {
    render(<MessageList items={items} streaming turnStartedAt={Date.now() - 4100} pendingApprovals={[approval]} />)
    expect(screen.getByRole('status').textContent).toBe('已暂停，等待你在下方确认操作')
    expect(screen.getByTestId('message-list').querySelector('[data-item="streaming"] .animate-spin')).toBeNull()
  })

  it('shows the live work clock in the header and keeps it out of the live region', () => {
    render(<MessageList items={[items[0]!]} streaming turnStartedAt={Date.now() - 4100} />)
    expect(screen.getByRole('status').textContent).toBe('正在生成')
    const header = screen.getByText(/^工作中/)
    expect(header.closest('[role="status"]')).toBeNull()
  })

  it('spells every tool row and plan step status in text, not only as an icon colour', () => {
    render(<MessageList items={items} />)
    // the done row has no visible status word: it carries a visually hidden one in its accessible name
    expect(screen.getByRole('button', { name: /今日 128 条消息.*已完成/ })).toBeTruthy()
    // the awaiting row already says 等待确认 in its badge, so nothing is added twice
    expect(screen.getAllByText('等待确认')).toHaveLength(1)
    expect(screen.getByText('搜索').closest('li')?.textContent).toContain('已完成')
    expect(screen.getByText('整理').closest('li')?.textContent).toContain('进行中')
  })

  it('dispatches error actions: settings command and retry through onResend', () => {
    const openSettings = vi.fn()
    const off = onCommand('tab.openSettings', openSettings)
    const onResend = vi.fn()
    render(<MessageList items={items} onResend={onResend} />)
    fireEvent.click(screen.getByRole('button', { name: '去改 Key' }))
    expect(openSettings).toHaveBeenCalledWith({ page: 'ai' })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onResend).toHaveBeenCalledWith('帮我总结「产品市场群」今天的讨论', [
      { kind: 'session', id: 's1', label: '产品市场群' },
    ])
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

  it('keeps stopping in the composer rather than duplicating it in the transcript', () => {
    // An empty thread shows nothing of its own: no greeting, no sample prompts (CLAUDE.md §14).
    const { container, unmount } = render(<MessageList items={[]} />)
    expect(container.textContent).toBe('')
    unmount()
    render(<MessageList items={[items[0]!]} streaming turnStartedAt={Date.now() - 4100} />)
    expect(screen.getByText(/^工作中/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull()
  })

  it('offers turn actions only after the final response, including corrections', () => {
    const first: ThreadItem = { kind: 'assistant', id: 'first', turnId, text: 'Initial response', streaming: false }
    const last: ThreadItem = { ...first, id: 'last', text: 'Correction' }
    const regenerate = vi.fn()
    const { rerender } = render(<MessageList items={[first, last]} onRegenerate={regenerate} />)
    expect(screen.getAllByRole('button', { name: '重新生成' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(regenerate).toHaveBeenCalledWith(last)
    rerender(<MessageList items={[first, { ...last, streaming: true }]} streaming onRegenerate={regenerate} />)
    expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull()
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('keeps completed history readable while omitting empty streaming placeholders', () => {
    const previous: ThreadItem = {
      kind: 'assistant',
      id: 'previous',
      turnId,
      text: 'Completed response',
      streaming: false,
    }
    const next: ThreadItem = { ...previous, id: 'next', turnId: 'trn_next' as TurnId, text: '', streaming: true }
    render(<MessageList items={[previous, next]} streaming onRegenerate={vi.fn()} />)
    expect(screen.getByText('Completed response')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull()
    expect(screen.getByTestId('message-list').querySelectorAll('[data-item="assistant"]')).toHaveLength(1)
  })

  it('folds a finished turn’s work behind 已工作 and keeps the final answer and its actions outside', () => {
    const turn: ThreadItem[] = [
      items[0]!,
      { kind: 'assistant', id: 'mid', turnId, text: '先读取群消息。', streaming: false },
      items[2]!.kind === 'tools' ? { ...items[2]!, calls: [items[2]!.calls[0]!] } : items[2]!,
      { kind: 'assistant', id: 'final', turnId, text: '今天讨论了三件事。', streaming: false, createdAt: AT + 95_000 },
    ]
    render(<MessageList items={turn} onRegenerate={vi.fn()} />)
    const header = screen.getByRole('button', { name: '已工作 1 分 35 秒' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('先读取群消息。')).toBeNull()
    expect(screen.queryByText('读取 产品市场群 · 今日 128 条消息')).toBeNull()
    expect(screen.getByText('今天讨论了三件事。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy()
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('先读取群消息。')).toBeTruthy()
    expect(screen.getByText('读取 产品市场群 · 今日 128 条消息')).toBeTruthy()
  })

  it('keeps a running turn open with its steps visible', () => {
    const running: ThreadItem[] = [
      items[0]!,
      { kind: 'assistant', id: 'mid', turnId, text: '先读取群消息。', streaming: false },
      items[2]!.kind === 'tools' ? { ...items[2]!, calls: [{ ...items[2]!.calls[0]!, status: 'running' }] } : items[2]!,
    ]
    render(<MessageList items={running} streaming turnStartedAt={Date.now()} />)
    expect(screen.queryByRole('button', { name: /^工作中/ })).toBeNull()
    expect(screen.getByText('先读取群消息。')).toBeTruthy()
    expect(screen.getByText('读取 产品市场群 · 今日 128 条消息').className).toContain('kit-shimmer')
  })

  it('folds two or more read-only calls into one 查阅 row', () => {
    const reads: ThreadItem = {
      kind: 'tools',
      id: 'reads',
      turnId,
      calls: ['A', 'B', 'C'].map((n) => ({
        callId: `r${n}` as CallId,
        toolName: 'search',
        summary: `检索 ${n}`,
        status: 'done' as const,
        risk: 'read' as const,
        input: { q: n },
        startedAt: AT,
        durationMs: 100,
      })),
    }
    render(<MessageList items={[reads]} />)
    const group = screen.getByRole('button', { name: /查阅.*3 个步骤/ })
    expect(screen.queryByText('检索 A')).toBeNull()
    fireEvent.click(group)
    expect(screen.getByText('检索 A')).toBeTruthy()
    expect(screen.getByText('检索 C')).toBeTruthy()
  })

  it('collapses a long prompt behind 展开', () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400)
    render(<MessageList items={[items[0]!]} />)
    const toggle = screen.getByRole('button', { name: '展开' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')
    scrollHeight.mockRestore()
  })

  it('keeps the whole answer outside the fold when a 更正 follows it, with both reasonings folded', () => {
    const turn: ThreadItem[] = [
      items[0]!,
      items[2]!.kind === 'tools' ? { ...items[2]!, calls: [items[2]!.calls[0]!] } : items[2]!,
      { kind: 'assistant', id: 'answer', turnId, text: '完整的回答。', reasoning: '先整理', streaming: false },
      { kind: 'assistant', id: 'fix', turnId, text: '更正：第二处引用贴错了。', reasoning: '核对', streaming: false },
    ]
    render(<MessageList items={turn} onRegenerate={vi.fn()} />)
    expect(screen.getByText('完整的回答。')).toBeTruthy()
    expect(screen.getByText('更正：第二处引用贴错了。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '已思考' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已处理' }))
    expect(screen.getAllByRole('button', { name: '已思考' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(2)
  })

  it('folds a draft that a check sent back, and shows only the rewritten answer', () => {
    const turn: ThreadItem[] = [
      items[0]!,
      { kind: 'assistant', id: 'draft', turnId, text: '初稿：她说“已经在一起了”。', streaming: false },
      { kind: 'revision', id: 'rev', turnId },
      { kind: 'assistant', id: 'final', turnId, text: '她只说了“再看看”。', streaming: false },
    ]
    render(<MessageList items={turn} />)
    expect(screen.getByText('她只说了“再看看”。')).toBeTruthy()
    expect(screen.queryByText('初稿：她说“已经在一起了”。')).toBeNull()
    // the prompt's own copy button plus the turn's action bar
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '已处理' }))
    expect(screen.getByText('初稿：她说“已经在一起了”。')).toBeTruthy()
    expect(screen.getByText('核对原文后重写了答复')).toBeTruthy()
  })
})

describe('input the kernel has not recorded yet', () => {
  const prompt: ThreadItem = {
    kind: 'user',
    id: 'u1',
    turnId,
    content: [{ type: 'text', text: '汇总三个群' }],
    mentions: [],
    createdAt: AT,
  }
  const running: ThreadItem = {
    kind: 'tools',
    id: 'tools_1',
    turnId,
    calls: [
      {
        callId: 'cal_1' as CallId,
        toolName: 'search_messages',
        summary: '检索消息',
        status: 'running',
        risk: 'read',
        input: null,
        startedAt: AT,
      },
    ],
  }

  it('shows a steer as pending after the transcript while the turn keeps working', () => {
    render(
      <MessageList
        items={[prompt, running]}
        streaming
        activeTurnId={turnId}
        pendingInputs={[
          {
            clientInputId: 'cin_1',
            content: [{ type: 'text', text: '顺便列出谁@了我' }],
            mentions: [],
            mode: 'steer',
            createdAt: AT,
          },
        ]}
      />,
    )
    const pending = screen.getByRole('article', { name: '待并入的消息' })
    expect(pending.textContent).toContain('顺便列出谁@了我')
    expect(pending.textContent).toContain('将在当前步骤结束后并入')
    // the running turn above it is still the one at work
    expect(screen.getByRole('status').textContent).toContain('正在执行工具')
  })

  it('shows the prompt of a turn that is still starting as that turn', () => {
    render(
      <MessageList
        items={[]}
        pendingInputs={[
          {
            clientInputId: 'cin_2',
            content: [{ type: 'text', text: '总结今天' }],
            mentions: [],
            mode: 'start',
            createdAt: AT,
          },
        ]}
      />,
    )
    expect(screen.getByRole('article', { name: '你' }).textContent).toContain('总结今天')
    expect(screen.queryByRole('article', { name: '待并入的消息' })).toBeNull()
  })

  it('offers to resend a last prompt that never got a reply, and can be dismissed', () => {
    localStorage.removeItem('aiwc.agent.unansweredDismissed')
    const onResend = vi.fn()
    const { rerender } = render(<MessageList items={[prompt]} onResendUnanswered={onResend} />)
    expect(screen.getByText('这条消息没有得到回复')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }))
    expect(onResend).toHaveBeenCalledWith(prompt)
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    expect(screen.queryByText('这条消息没有得到回复')).toBeNull()
    // dismissed for good, and never shown while a turn runs
    rerender(<MessageList items={[prompt]} onResendUnanswered={onResend} streaming />)
    expect(screen.queryByText('这条消息没有得到回复')).toBeNull()
    localStorage.removeItem('aiwc.agent.unansweredDismissed')
  })
})

describe('rewind, fork and find', () => {
  const turn = items.slice(0, 2)

  it('edits a prompt in place and hands the edited text to onEditSubmit', () => {
    const onEditSubmit = vi.fn()
    const { rerender } = render(<MessageList items={turn} onEditSubmit={onEditSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('textbox', { name: '编辑提问' })
    fireEvent.change(editor, { target: { value: '换个问法' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    const prompt = turn[0]!
    expect(onEditSubmit).toHaveBeenCalledWith(prompt, '换个问法', prompt.kind === 'user' ? prompt.mentions : [])
    // until the rewind goes ahead (a confirmation may still be cancelled) the editor keeps the edit
    rerender(<MessageList items={turn} onEditSubmit={onEditSubmit} />)
    expect((screen.getByRole('textbox', { name: '编辑提问' }) as HTMLTextAreaElement).value).toBe('换个问法')
    // the rewind removed the prompt: the editor goes with it
    rerender(<MessageList items={[]} onEditSubmit={onEditSubmit} />)
    expect(screen.queryByRole('textbox', { name: '编辑提问' })).toBeNull()
  })

  it('edits one prompt at a time', () => {
    const second: ThreadItem = {
      kind: 'user',
      id: 'u_second',
      turnId,
      content: [{ type: 'text', text: '第二问' }],
      mentions: [],
    }
    render(<MessageList items={[...turn, second]} onEditSubmit={vi.fn()} />)
    const [first, next] = screen.getAllByRole('button', { name: '编辑' })
    fireEvent.click(first!)
    fireEvent.click(next!)
    const editors = screen.getAllByRole('textbox', { name: '编辑提问' })
    expect(editors).toHaveLength(1)
    expect((editors[0] as HTMLTextAreaElement).value).toBe('第二问')
    fireEvent.keyDown(editors[0]!, { key: 'Escape' })
  })

  it('cancels an edit with Esc, and offers no in-place edit while the turn runs', () => {
    const onEditSubmit = vi.fn()
    const { rerender } = render(<MessageList items={turn} onEditSubmit={onEditSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: '编辑提问' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '编辑提问' })).toBeNull()
    rerender(<MessageList items={turn} onEditSubmit={onEditSubmit} streaming />)
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(onEditSubmit).not.toHaveBeenCalled()
  })

  it('forks from a finished turn through its action bar', () => {
    const onFork = vi.fn()
    render(<MessageList items={turn} onFork={onFork} />)
    fireEvent.click(screen.getByRole('button', { name: '从这一轮分出新会话' }))
    expect(onFork).toHaveBeenCalledWith(turn[0])
  })

  it('opens the find bar on request, reports no results, and closes with Esc', () => {
    const { rerender } = render(<MessageList items={turn} findRequestSeq={0} />)
    expect(screen.queryByRole('search', { name: '在对话中查找' })).toBeNull()
    rerender(<MessageList items={turn} findRequestSeq={1} />)
    const box = screen.getByRole('searchbox', { name: '在对话中查找' })
    fireEvent.change(box, { target: { value: '找不到的词' } })
    expect(screen.getByText('无结果')).toBeTruthy()
    fireEvent.change(box, { target: { value: '产品市场群' } })
    expect(screen.getByText(/^1\/\d+$/)).toBeTruthy()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('search', { name: '在对话中查找' })).toBeNull()
  })
})
