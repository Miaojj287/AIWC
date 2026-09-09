// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuSpec } from '@/kit'
import { overflowMenuSpec, TabStrip, tabMenuSpec } from './TabStrip'
import { registerTab, type TabDescriptor, type TabRendererProps } from './tabRegistry'
import { useTabsStore } from './tabsStore'

const Noop = (_p: TabRendererProps) => null
registerTab({ kind: 'chat', icon: 'message-square', component: Noop })
registerTab({ kind: 'settings', icon: 'settings', component: Noop })
registerTab({ kind: 'file', icon: 'file-text', component: Noop })

const tabs = () => useTabsStore.getState()

// jsdom has no PointerEvent: give fireEvent.pointer* a constructor that keeps button / clientX / pointerId.
class FakePointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
  }
}
if (typeof window.PointerEvent === 'undefined') (window as unknown as { PointerEvent: typeof FakePointerEvent }).PointerEvent = FakePointerEvent

const labels = (spec: MenuSpec) => spec.map((it) => (it.type === 'separator' ? '—' : it.type === 'label' ? `#${String(it.label)}` : String(it.label)))

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
})
afterEach(cleanup)

const middleClick = (el: HTMLElement) => fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))

function closeDirectly(id: string) {
  tabs().close(id)
  return true
}

describe('TabStrip', () => {
  it('renders tabs pinned-first, marks the active one and closes via × / middle click', () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: '产品市场群' })
    tabs().open({ kind: 'settings', objectId: 'settings', title: '设置' })
    tabs().open({ kind: 'file', objectId: '/tmp/周报.md', title: '周报.md' })
    tabs().pin('file:/tmp/周报.md', true)
    tabs().activate('settings:settings')

    render(<TabStrip onRequestClose={closeDirectly} />)
    const list = screen.getByRole('tablist')
    const rendered = within(list).getAllByRole('tab')
    expect(rendered.map((el) => el.getAttribute('title'))).toEqual(['周报.md', '产品市场群', '设置'])
    expect(rendered[2]?.getAttribute('aria-selected')).toBe('true')
    // pinned tabs have no ×
    expect(within(rendered[0] as HTMLElement).queryByRole('button', { name: /关闭/ })).toBeNull()

    fireEvent.click(within(rendered[2] as HTMLElement).getByRole('button', { name: '关闭 设置' }))
    expect(tabs().tabs.map((t) => t.id)).toEqual(['file:/tmp/周报.md', 'chat:s1'])
    expect(tabs().recentlyClosed[0]?.id).toBe('settings:settings')

    middleClick(screen.getByTitle('产品市场群'))
    expect(tabs().tabs.map((t) => t.id)).toEqual(['file:/tmp/周报.md'])

    act(() => tabs().reopenLastClosed())
    expect(tabs().activeId).toBe('chat:s1')
    expect(screen.getAllByRole('tab').map((el) => el.getAttribute('title'))).toEqual(['周报.md', '产品市场群'])
  })

  it('activates a tab on press and re-orders the store while dragging', () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: 'A' })
    tabs().open({ kind: 'chat', objectId: 's2', title: 'B' })
    tabs().open({ kind: 'chat', objectId: 's3', title: 'C' })
    render(<TabStrip onRequestClose={closeDirectly} />)
    const [a, b, c] = screen.getAllByRole('tab') as HTMLElement[]
    // lay the tabs out: 100px each
    const rect = (x: number) => ({ left: x, right: x + 100, width: 100, top: 0, bottom: 40, height: 40, x, y: 0, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(a!, 'getBoundingClientRect').mockReturnValue(rect(0))
    vi.spyOn(b!, 'getBoundingClientRect').mockReturnValue(rect(100))
    vi.spyOn(c!, 'getBoundingClientRect').mockReturnValue(rect(200))

    fireEvent.pointerDown(a!, { button: 0, pointerId: 1, clientX: 50 })
    expect(tabs().activeId).toBe('chat:s1')
    fireEvent.pointerMove(a!, { pointerId: 1, clientX: 52 }) // below threshold
    expect(tabs().tabs.map((t) => t.objectId)).toEqual(['s1', 's2', 's3'])
    fireEvent.pointerMove(a!, { pointerId: 1, clientX: 260 }) // past C's midpoint
    expect(tabs().tabs.map((t) => t.objectId)).toEqual(['s2', 's3', 's1'])
    fireEvent.pointerUp(a!, { pointerId: 1, clientX: 260 })
    expect(tabs().activeId).toBe('chat:s1')
  })

  it('shows the dirty dot and hands close requests to the guard', async () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: 'A' })
    tabs().update('chat:s1', { dirty: true })
    const onRequestClose = vi.fn(() => false)
    render(<TabStrip onRequestClose={onRequestClose} />)
    expect(screen.getByLabelText('未保存')).toBeTruthy()
    middleClick(screen.getByTitle('A'))
    expect(onRequestClose).toHaveBeenCalledWith('chat:s1')
    expect(tabs().tabs).toHaveLength(1)
  })
})

describe('menu specs', () => {
  const tab: TabDescriptor = { id: 'chat:s1', kind: 'chat', objectId: 's1', title: 'A' }
  const ctx = { mac: true, canReopen: false, hasOthers: true, hasRight: false, close: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn(), togglePin: vi.fn(), reopen: vi.fn() }

  it('orders the tab menu 关闭 → 关闭其他 → 关闭右侧 — 固定 — 恢复 and disables what does not apply', () => {
    const spec = tabMenuSpec(tab, ctx)
    expect(labels(spec)).toEqual(['关闭', '关闭其他', '关闭右侧', '—', '固定标签', '—', '恢复已关闭的标签'])
    const byId = (id: string) => spec.find((it) => 'id' in it && it.id === id)
    expect(byId('close')).toMatchObject({ shortcut: '⌘W', disabled: false })
    expect(byId('closeRight')).toMatchObject({ disabled: true })
    expect(byId('reopen')).toMatchObject({ disabled: true, shortcut: '⌘⇧T' })
    expect(labels(tabMenuSpec({ ...tab, pinned: true }, ctx))).toContain('取消固定')
    expect(tabMenuSpec({ ...tab, pinned: true }, ctx)[0]).toMatchObject({ disabled: true })
    expect(spec.some((it) => 'danger' in it && it.danger)).toBe(false)
  })

  it('lists every tab in the overflow menu with the active one checked', () => {
    const all: TabDescriptor[] = [tab, { id: 'settings:settings', kind: 'settings', objectId: 'settings', title: '设置' }]
    const spec = overflowMenuSpec(all, 'settings:settings', { mac: true, canReopen: true, activate: vi.fn(), reopen: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn() })
    expect(labels(spec)).toEqual(['#标签页 · 2', 'A', '设置', '—', '恢复已关闭的标签', '关闭其他', '关闭右侧'])
    const settingsItem = spec.find((it) => 'id' in it && it.id === 'tab:settings:settings')
    expect(settingsItem && 'badge' in settingsItem && settingsItem.badge).toBeTruthy()
    const closeRight = spec.find((it) => 'id' in it && it.id === 'closeRight')
    expect(closeRight).toMatchObject({ disabled: true })
  })
})
