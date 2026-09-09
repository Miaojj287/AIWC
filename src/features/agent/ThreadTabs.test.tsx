// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { ThreadTabs } from './ThreadTabs'
import { patchJsdomTopLayerMatches } from './testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(cleanup)

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }
const thread = (n: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: `thr_${n}` as ThreadId,
  title: `会话 ${n}`,
  origin: { channel: 'desktop' },
  settings,
  createdAt: n,
  updatedAt: n,
  pinned: false,
  ...patch,
})

function renderTabs(all: ThreadSummary[], onSelect = vi.fn(), spies: { onAction?: ReturnType<typeof vi.fn>; onPin?: ReturnType<typeof vi.fn> } = {}) {
  const noop = () => undefined
  render(
    <ThreadTabs
      open={all.slice(0, 1)}
      all={all}
      activeId={all[0]?.threadId ?? null}
      mac
      onSelect={onSelect}
      onClose={noop}
      onCloseOthers={noop}
      onNew={noop}
      onPin={spies.onPin ?? noop}
      onAction={spies.onAction ?? noop}
      onToggleCollapsed={noop}
    />,
  )
  return onSelect
}

describe('<ThreadTabs> history popover', () => {
  it('lists recent threads as kit menu rows (h42 with description) and selects on click', async () => {
    const all = [thread(1, { contextRef: { kind: 'session', id: 's1', label: '产品市场群' } }), thread(2, { pinned: true })]
    const onSelect = renderTabs(all)
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]?.className).toContain('h-[42px]')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.textContent).toContain('产品市场群')
    expect(options[1]?.textContent).toContain('无引用')
    fireEvent.click(options[1]!)
    expect(onSelect).toHaveBeenCalledWith('thr_2')
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
  })

  it('clears the previous search after picking a history result', async () => {
    renderTabs([thread(1), thread(2)])
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: '会话 2' } })
    fireEvent.click(screen.getByRole('option'))
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    expect(await screen.findAllByRole('option')).toHaveLength(2)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  })

  it('caps the recent list at five, offers 查看全部 as a menu row and filters by the search box', async () => {
    const all = Array.from({ length: 7 }, (_, i) => thread(i + 1))
    renderTabs(all)
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    expect(await screen.findAllByRole('option')).toHaveLength(5)
    const more = screen.getByRole('button', { name: '查看全部 7 个会话' })
    expect(more.className).toContain('h-[30px]')
    fireEvent.click(more)
    expect(screen.getAllByRole('option')).toHaveLength(7)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), { target: { value: '会话 6' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), { target: { value: '没有这个' } })
    await waitFor(() => expect(screen.getByText('没有匹配的会话')).toBeTruthy())
  })
})

describe('<ThreadTabs> thread actions', () => {
  it('allows renaming a local draft but disables actions that require saved history', async () => {
    const draft = thread(1)
    const onAction = vi.fn()
    const noop = () => undefined
    render(<ThreadTabs open={[draft]} all={[]} activeId={draft.threadId} mac onSelect={noop} onClose={noop} onCloseOthers={noop} onNew={noop} onPin={noop} onAction={onAction} onToggleCollapsed={noop} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '会话菜单' }), { key: 'Enter' })
    const rename = await screen.findByRole('menuitem', { name: '重命名会话' })
    expect(rename.getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getByRole('menuitem', { name: '导出对话' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '固定会话' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(rename)
    expect(onAction).toHaveBeenCalledWith('rename', draft.threadId)
  })

  it('offers 删除会话 on every history row — the popover used to be a read-only list', async () => {
    const onAction = vi.fn()
    renderTabs([thread(1), thread(2)], vi.fn(), { onAction })
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    await screen.findAllByRole('option')
    // Radix opens a DropdownMenu on pointerdown, not click
    fireEvent.pointerDown(screen.getByRole('button', { name: '会话 2 的更多操作' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除会话' }))
    expect(onAction).toHaveBeenCalledWith('delete', 'thr_2')
    // the popover closes first, so the confirm dialog is not opened underneath it
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
  })

  it('offers 删除会话 in a tab right-click menu as the last, danger item', async () => {
    const onAction = vi.fn()
    renderTabs([thread(1)], vi.fn(), { onAction })
    fireEvent.contextMenu(screen.getByRole('tab', { name: /会话 1/ }))
    const items = await screen.findAllByRole('menuitem')
    const remove = items.at(-1)!
    expect(remove.textContent).toContain('删除会话')
    expect(remove.className).toContain('danger')
    fireEvent.click(remove)
    expect(onAction).toHaveBeenCalledWith('delete', 'thr_1')
  })
})
