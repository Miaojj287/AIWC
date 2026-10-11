// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  THREAD_SEARCH_MARKS,
  type AiwcBridge,
  type ThreadId,
  type ThreadSearchHit,
  type ThreadSummary,
} from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetAgentStoreForTests, useAgentStore } from './agentStore'
import { ThreadTabs } from './ThreadTabs'
import { patchJsdomTopLayerMatches } from './testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetAgentStoreForTests()
})

/** agent:searchThreads answers with these content hits; nothing else is called by the strip. */
function searchBridge(hits: ThreadSearchHit[] = []): void {
  __setBridgeForTests({
    runtime: 'web',
    platform: 'darwin',
    on: () => () => undefined,
    invoke: (async (channel: string) => {
      if (channel === 'agent:searchThreads') return hits
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  })
}

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

function renderTabs(
  all: ThreadSummary[],
  onSelect = vi.fn(),
  spies: {
    onAction?: ReturnType<typeof vi.fn>
    onPin?: ReturnType<typeof vi.fn>
    onOpenWindow?: ReturnType<typeof vi.fn>
  } = {},
) {
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
      onOpenWindow={spies.onOpenWindow ?? noop}
    />,
  )
  return onSelect
}

describe('<ThreadTabs> history popover', () => {
  it('lists recent threads as kit menu rows (h42 with description) and selects on click', async () => {
    const all = [
      thread(1, { contextRef: { kind: 'session', id: 's1', label: '产品市场群' } }),
      thread(2, { pinned: true }),
    ]
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
    searchBridge()
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

  it('finds words inside conversations and opens the thread at the matching turn', async () => {
    const [o, c] = THREAD_SEARCH_MARKS
    searchBridge([
      { threadId: 'thr_9' as ThreadId, title: '旧会话', itemId: 'itm_42', snippet: `…项目群${o}报价${c}讨论…`, ts: 1 },
      // already listed as a title match: shown once
      { threadId: 'thr_1' as ThreadId, title: '会话 1', itemId: 'itm_1', snippet: `${o}报价${c}`, ts: 2 },
    ])
    const reveal = vi.spyOn(useAgentStore.getState(), 'revealItem')
    renderTabs([thread(1, { title: '报价会话 1' }), thread(2)])
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: '报价' } })
    const content = await screen.findByRole('group', { name: '内容匹配' })
    expect(screen.getByRole('group', { name: '标题匹配' }).textContent).toContain('报价会话 1')
    const hit = content.querySelector('[role="option"]') as HTMLElement
    expect(hit.textContent).toContain('旧会话')
    expect(hit.querySelector('mark')?.textContent).toBe('报价')
    expect(content.querySelectorAll('[role="option"]')).toHaveLength(1)
    fireEvent.click(hit)
    expect(reveal).toHaveBeenCalledWith('thr_9', 'itm_42')
  })

  it('says the search stays on this computer when nothing matches', async () => {
    searchBridge([])
    renderTabs([thread(1)])
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: '不存在的词' } })
    expect(await screen.findByText('只在本机记录中搜索')).toBeTruthy()
  })

  it('offers 加载更多 for older threads once everything loaded is shown', async () => {
    searchBridge()
    useAgentStore.setState({ hasMoreThreads: true })
    const loadMore = vi.spyOn(useAgentStore.getState(), 'loadMoreThreads').mockResolvedValue()
    renderTabs([thread(1), thread(2)])
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('is one tab stop: ↓ from the search box enters the list, arrows move between rows', async () => {
    renderTabs([thread(1), thread(2), thread(3)])
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }))
    const options = await screen.findAllByRole('option')
    // roving tabindex: only the open thread's row is in the tab order, together with its own ···
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1])
    expect(screen.getByRole('button', { name: '会话 1 的更多操作' }).tabIndex).toBe(0)
    expect(screen.getByRole('button', { name: '会话 2 的更多操作' }).tabIndex).toBe(-1)

    const search = screen.getByRole('searchbox', { name: '搜索会话' })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options[0])
    fireEvent.keyDown(options[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options[1])
    // the tab stop follows focus, so Tab reaches this row's ··· next
    expect(screen.getAllByRole('option').map((o) => o.tabIndex)).toEqual([-1, 0, -1])
    fireEvent.keyDown(options[1]!, { key: 'End' })
    expect(document.activeElement).toBe(options[2])
    fireEvent.keyDown(options[2]!, { key: 'Home' })
    expect(document.activeElement).toBe(options[0])
  })
})

describe('<ThreadTabs> strip semantics and focus', () => {
  function Strip() {
    const all = [thread(1), thread(2), thread(3)]
    const [openIds, setOpenIds] = useState(all.map((t) => t.threadId))
    const [activeId, setActiveId] = useState<ThreadId | null>(all[2]!.threadId)
    const noop = () => undefined
    return (
      <ThreadTabs
        open={all.filter((t) => openIds.includes(t.threadId))}
        all={all}
        activeId={activeId}
        mac
        onSelect={setActiveId}
        onClose={(id) => {
          // same rule as agentStore.closeThread: the neighbour takes over
          const idx = openIds.indexOf(id)
          const next = openIds.filter((x) => x !== id)
          setOpenIds(next)
          if (activeId === id) setActiveId(next[Math.min(idx, next.length - 1)] ?? null)
        }}
        onCloseOthers={noop}
        onNew={noop}
        onPin={noop}
        onAction={noop}
        onToggleCollapsed={noop}
        onOpenWindow={noop}
      />
    )
  }

  it('keeps the toolbar buttons out of the tablist', () => {
    render(<Strip />)
    const tablist = screen.getByRole('tablist', { name: 'Agent 会话' })
    expect(screen.getAllByRole('tab').every((tab) => tablist.contains(tab))).toBe(true)
    for (const name of ['新会话', '历史会话', '会话菜单', '收起 Agent 面板', 'Agent 窗口'])
      expect(tablist.contains(screen.getByRole('button', { name }))).toBe(false)
  })

  it('moves focus to the tab that became active after closing one with × or Delete', () => {
    render(<Strip />)
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 3' }))
    const second = screen.getByRole('tab', { name: /会话 2/ })
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(second)

    fireEvent.keyDown(second, { key: 'Delete' })
    const first = screen.getByRole('tab', { name: /会话 1/ })
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(first)
  })
})

describe('<ThreadTabs> thread actions', () => {
  it('allows renaming a local draft but disables actions that require saved history', async () => {
    const draft = thread(1)
    const onAction = vi.fn()
    const noop = () => undefined
    render(
      <ThreadTabs
        open={[draft]}
        all={[]}
        activeId={draft.threadId}
        mac
        onSelect={noop}
        onClose={noop}
        onCloseOthers={noop}
        onNew={noop}
        onPin={noop}
        onAction={onAction}
        onToggleCollapsed={noop}
        onOpenWindow={noop}
      />,
    )
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

describe('<ThreadTabs> Agent window entry', () => {
  it('shows the 「Agent 窗口」 switch as the rightmost control — an icon, not a text pill — and reports the click', () => {
    const onOpenWindow = vi.fn()
    renderTabs([thread(1)], vi.fn(), { onOpenWindow })
    const entry = screen.getByRole('button', { name: 'Agent 窗口' })
    const controls = entry.parentElement!
    expect(controls.lastElementChild).toBe(entry)
    // the 360px strip has no room for a label: the name lives in aria-label and the tooltip
    expect(entry.textContent).toBe('')
    fireEvent.click(entry)
    expect(onOpenWindow).toHaveBeenCalledTimes(1)
  })
})
