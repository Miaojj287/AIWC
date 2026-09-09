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

function Harness({ onSubmit, onStop, streaming = false }: { onSubmit?: (text: string, mentions: Mention[]) => void; onStop?: () => void; streaming?: boolean }) {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  return (
    <>
      <Composer value={text} onValueChange={setText} mentions={mentions} onMentionsChange={setMentions} onSubmit={() => onSubmit?.(text, mentions)} onStop={onStop} streaming={streaming} mentionSources={sources} skills={skills} />
      <output data-testid="state">{JSON.stringify({ text, mentions })}</output>
    </>
  )
}

const textarea = () => screen.getByRole('textbox', { name: '给 Agent 的消息' }) as HTMLTextAreaElement
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

  it('shows the stop control while streaming', () => {
    const onStop = vi.fn()
    render(<Harness onStop={onStop} streaming />)
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('opens the mention popover on @, navigates with arrows and inserts a chip on Enter', async () => {
    render(<Harness />)
    type('总结 @')
    await waitFor(() => expect(screen.getByText('产品市场群')).toBeTruthy())
    expect(screen.getByText('投研交流群')).toBeTruthy()
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').mentions).toEqual([{ kind: 'session', id: 's2', label: '投研交流群' }]))
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').text).toBe('总结 ')
    expect(screen.queryByText('引用候选')).toBeNull()
    // the chip is removable
    fireEvent.click(screen.getByRole('button', { name: '移除 投研交流群' }))
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').mentions).toEqual([]))
  })

  it('filters mention candidates by the typed query and closes on Escape', async () => {
    render(<Harness />)
    type('@投研')
    await waitFor(() => expect(screen.getByText('投研交流群')).toBeTruthy())
    expect(screen.queryByText('产品市场群')).toBeNull()
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '引用候选' })).toBeNull())
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
})
