// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Mention, SkillSummary } from '@aiwc/protocol'
import { Composer } from './Composer'
import type { MentionCandidate, MentionSources } from './mentionSources'
import { patchJsdomTopLayerMatches } from './testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(cleanup)

const SESSIONS: MentionCandidate[] = [
  { kind: 'session', id: 's1', label: '产品市场群', subtitle: '群聊' },
  { kind: 'session', id: 's2', label: '投研交流群', subtitle: '群聊' },
]

const sources: MentionSources = {
  search: async (kind, query) => (kind === 'session' ? SESSIONS.filter((c) => c.label.includes(query)) : []),
}

const skills: SkillSummary[] = [
  { name: '生成周报草稿', description: '按周报模板整理', command: '/周报', source: 'builtin' },
  { name: '总结当前会话', description: '输出议题与结论', command: '/总结', source: 'builtin' },
]

function Harness({
  onSubmit,
  onStop,
  streaming = false,
  history,
}: {
  onSubmit?: (text: string, mentions: Mention[]) => void
  onStop?: () => void
  streaming?: boolean
  history?: string[]
}) {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  return (
    <>
      <Composer
        value={text}
        onValueChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        onSubmit={() => onSubmit?.(text, mentions)}
        onStop={onStop}
        history={history}
        streaming={streaming}
        mentionSources={sources}
        skills={skills}
      />
      <output data-testid="state">{JSON.stringify({ text, mentions })}</output>
    </>
  )
}

// By label, not by role: the field is a textbox until `@` / `/` suggestions open, then a combobox.
const textarea = () => screen.getByLabelText('给 Agent 的消息') as HTMLTextAreaElement
const type = (value: string) => {
  const el = textarea()
  fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
}

describe('<Composer>', () => {
  it('disables send when empty, sends on Enter, keeps newline on Shift+Enter', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    expect(screen.getByRole('button', { name: '输入内容后发送' }).getAttribute('aria-disabled')).toBe('true')
    type('你好')
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('你好', [])
    fireEvent.keyDown(textarea(), { key: 'Enter', metaKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledTimes(3)
  })

  it('does not send while confirming Chinese input', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    type('你好')
    fireEvent.keyDown(textarea(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(textarea(), { key: 'Enter', keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows stop while streaming with an empty draft, and send (steer) once there is text', () => {
    const onStop = vi.fn()
    const onSubmit = vi.fn()
    render(<Harness onStop={onStop} onSubmit={onSubmit} streaming />)
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    type('换个角度')
    expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '发送并引导当前任务' }))
    expect(onSubmit).toHaveBeenCalledWith('换个角度', [])
  })

  it('stops a running turn on Esc, but not while a popover is open or when idle', async () => {
    const onStop = vi.fn()
    const { rerender } = render(<Harness onStop={onStop} />)
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(onStop).not.toHaveBeenCalled()
    rerender(<Harness onStop={onStop} streaming />)
    type('@')
    await waitFor(() => expect(screen.getByRole('listbox', { name: '引用候选' })).toBeTruthy())
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(onStop).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('steps through earlier prompts with ↑ / ↓ from an empty draft', () => {
    render(<Harness history={['第一条', '第二条']} />)
    const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}').text as string
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' })
    expect(state()).toBe('第二条')
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' })
    expect(state()).toBe('第一条')
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    expect(state()).toBe('第二条')
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    expect(state()).toBe('')
    // a draft being written is never replaced
    type('草稿')
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' })
    expect(state()).toBe('草稿')
  })

  it('opens the mention popover from ＋ 添加上下文', async () => {
    render(<Harness />)
    type('总结')
    fireEvent.click(screen.getByRole('button', { name: '添加上下文' }))
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('总结 @')
    await waitFor(() => expect(screen.getByRole('listbox', { name: '引用候选' })).toBeTruthy())
  })

  it('opens the mention popover on @, navigates with arrows and inserts a chip on Enter', async () => {
    render(<Harness />)
    expect(screen.getByRole('textbox', { name: '给 Agent 的消息' })).toBeTruthy()
    type('总结 @')
    await waitFor(() => expect(screen.getByText('产品市场群')).toBeTruthy())
    expect(screen.getByText('投研交流群')).toBeTruthy()
    // combobox over the listbox itself (not the popover frame), with the highlighted option named
    const combobox = screen.getByRole('combobox', { name: '给 Agent 的消息' })
    expect(combobox).toBe(textarea())
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox')
    expect(combobox.getAttribute('aria-autocomplete')).toBe('list')
    const listbox = screen.getByRole('listbox', { name: '引用候选' })
    expect(combobox.getAttribute('aria-controls')).toBe(listbox.id)
    expect(combobox.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id)
    expect(screen.getByText('2 个候选项').closest('[aria-live="polite"]')).toBeTruthy()
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    expect(combobox.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]?.id)
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').mentions).toEqual([
        { kind: 'session', id: 's2', label: '投研交流群' },
      ]),
    )
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('总结 ')
    expect(screen.queryByText('引用候选')).toBeNull()
    // the chip is removable from the keyboard: Delete on the focused chip
    fireEvent.keyDown(screen.getByRole('button', { name: '投研交流群' }), { key: 'Delete' })
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').mentions).toEqual([]))
  })

  it('filters mention candidates by the typed query and closes on Escape', async () => {
    render(<Harness />)
    type('@投研')
    await waitFor(() => expect(screen.getByText('投研交流群')).toBeTruthy())
    expect(screen.queryByText('产品市场群')).toBeNull()
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '引用候选' })).toBeNull())
    expect(screen.getByRole('textbox', { name: '给 Agent 的消息' })).toBeTruthy()
  })

  it('announces an empty result politely and keeps it outside the listbox', async () => {
    render(<Harness />)
    type('@不存在的会话')
    const empty = await screen.findByText('没有匹配项')
    expect(empty.closest('[aria-live="polite"]')).toBeTruthy()
    expect(empty.closest('[role="listbox"]')).toBeNull()
    expect(textarea().getAttribute('aria-activedescendant')).toBeNull()
  })

  it('opens the skills popover on / and inserts the command', async () => {
    render(<Harness />)
    await act(async () => {
      type('/周')
    })
    await waitFor(() => expect(screen.getByText('生成周报草稿')).toBeTruthy())
    expect(screen.queryByText('总结当前会话')).toBeNull()
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('/周报 '))
  })

  it('works with a Chinese input method: 、 typed first opens skills, @ after Chinese text opens mentions', async () => {
    render(<Harness />)
    await act(async () => {
      type('、')
    })
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('/')
    await waitFor(() => expect(screen.getByText('生成周报草稿')).toBeTruthy())
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    type('')
    type('总结@产品')
    await waitFor(() => expect(screen.getByText('产品市场群')).toBeTruthy())
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
        text: '总结',
        mentions: [{ kind: 'session', id: 's1', label: '产品市场群' }],
      }),
    )
  })

  it('keeps 、 inside a sentence as punctuation', () => {
    render(<Harness />)
    type('苹果')
    type('苹果、')
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('苹果、')
  })
})
