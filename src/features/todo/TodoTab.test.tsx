// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearToasts, getToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { createMockBridge, demoFixture, type MockBridge } from '@/platform/mockBridge'
import type { TabDescriptor } from '@/workspace/tabRegistry'
import { TodoTab } from './TodoTab'
import { __resetTodoStoreForTests } from './todoStore'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let bridge: MockBridge
const group = demoFixture.sessions.find((s) => s.kind === 'group')!

function mount(state?: Record<string, unknown>) {
  const tab: TabDescriptor = { id: 'todo:todo', kind: 'todo', objectId: 'todo', title: '每日待办', state }
  return render(<TodoTab tab={tab} active update={() => {}} requestClose={() => {}} />)
}

beforeEach(async () => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  __setBridgeForTests(bridge)
  __resetConfigStoreForTests()
  __resetTodoStoreForTests()
  clearToasts()
  await useConfigStore.getState().hydrate()
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('TodoTab', () => {
  it('is off by default: says so and turns on from the empty state', async () => {
    mount()
    expect(await screen.findByText('每日待办还没开启')).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    const scan = screen.getByRole('button', { name: '立即扫描' })
    expect((scan as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '开启' }))
    await waitFor(() => expect(useConfigStore.getState().config?.todo.enabled).toBe(true))
    expect(await screen.findByText('还没有选择群聊：在左侧列表打开要扫描的群聊')).toBeTruthy()
  })

  it('adds, checks off, deletes and undoes to-dos like a notes checklist', async () => {
    await useConfigStore.getState().set({ todo: { enabled: true, sources: [{ id: group.id, title: group.title }] } })
    mount()
    const input = await screen.findByRole('textbox', { name: '新待办' })
    fireEvent.change(input, { target: { value: '给妈妈打电话' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: '给妈妈打电话' })).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByRole('checkbox', { name: '完成「给妈妈打电话」' }))
    expect(await screen.findByRole('button', { name: /已完成 1/ })).toBeTruthy()
    expect((await bridge.invoke('todo:list', undefined))[0]?.done).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /已完成 1/ }))
    const row = screen.getByRole('button', { name: '给妈妈打电话' }).closest('[role="listitem"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '给妈妈打电话' })).toBeNull())
    const toast = getToasts().find((x) => x.text === '已删除待办')
    expect(toast?.action?.label).toBe('撤销')
    await act(async () => toast?.action?.onClick())
    expect(await screen.findByRole('button', { name: /已完成 1/ })).toBeTruthy()
    expect(await bridge.invoke('todo:list', undefined)).toHaveLength(1)
  })

  it('edits a to-do in place and Escape keeps the old text', async () => {
    await bridge.invoke('todo:add', { text: '交周报' })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '交周报' }))
    const edit = screen.getByRole('textbox', { name: '编辑待办' })
    fireEvent.change(edit, { target: { value: '周五前交周报' } })
    fireEvent.keyDown(edit, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: '周五前交周报' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '周五前交周报' }))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑待办' }), { target: { value: '改掉' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '编辑待办' }), { key: 'Escape' })
    expect(await screen.findByRole('button', { name: '周五前交周报' })).toBeTruthy()
    expect((await bridge.invoke('todo:list', undefined))[0]?.text).toBe('周五前交周报')
  })

  it('narrowed to a chat that is not scanned, offers to add it', async () => {
    await useConfigStore.getState().set({ todo: { enabled: true } })
    mount({ sourceId: group.id })
    fireEvent.click(await screen.findByRole('button', { name: '加入扫描' }))
    await waitFor(() => expect(useConfigStore.getState().config?.todo.sources.map((s) => s.id)).toEqual([group.id]))
    // A narrowed dashboard has no 新待办 line: typed items belong to no chat.
    expect(screen.queryByRole('textbox', { name: '新待办' })).toBeNull()
  })
})
