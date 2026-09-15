// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '@/app/commands'
import { __resetShellStoreForTests, useShellStore } from '@/shell/shellStore'
import { registerTab, type TabRendererProps } from './tabRegistry'
import { useTabsStore } from './tabsStore'
import { KEEP_MOUNTED, Workspace } from './Workspace'

let mounts = 0
/** Object ids whose tab renderer throws while rendering. */
const crashing = new Set<string>()
function Probe({ tab, active, update }: TabRendererProps) {
  mounts++
  if (crashing.has(tab.objectId)) throw new Error(`render failed: ${tab.objectId}`)
  return (
    <div data-testid={`probe-${tab.objectId}`} data-active={active}>
      <span>{tab.title}</span>
      <button type="button" onClick={() => update({ dirty: true })}>
        修改
      </button>
    </div>
  )
}
registerTab({ kind: 'chat', icon: 'message-square', component: Probe })
registerTab({ kind: 'file', icon: 'file-text', component: Probe })

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))
const tabs = () => useTabsStore.getState()

beforeEach(() => {
  mounts = 0
  crashing.clear()
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Workspace', () => {
  it('shows the per-function empty state and the ⌘K hint when nothing is open', () => {
    render(<Workspace mac />)
    expect(screen.getByTestId('workspace-empty').textContent).toContain('从左侧选择一个会话')
    expect(screen.getByText('⌘K')).toBeTruthy()
    act(() => useShellStore.getState().setRail('clone'))
    expect(screen.getByTestId('workspace-empty').textContent).toContain('选择一位联系人开始克隆')
  })

  it('renders the active tab and keeps only the last 3 visited tabs mounted', () => {
    render(<Workspace mac />)
    act(() => runCommand('tab.openChat', { sessionId: 's1', title: 'A' }))
    act(() => runCommand('tab.openChat', { sessionId: 's2', title: 'B' }))
    act(() => runCommand('tab.openChat', { sessionId: 's3', title: 'C' }))
    act(() => runCommand('tab.openChat', { sessionId: 's4', title: 'D' }))
    expect(screen.queryByTestId('workspace-empty')).toBeNull()
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(KEEP_MOUNTED)
    expect(screen.getByTestId('probe-s4').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('probe-s3').getAttribute('data-active')).toBe('false')
    expect(screen.queryByTestId('probe-s1')).toBeNull()
    // the hidden ones are hidden, not unmounted
    expect((screen.getByTestId('probe-s3').closest('[role=tabpanel]') as HTMLElement).hidden).toBe(true)
    expect((screen.getByTestId('probe-s4').closest('[role=tabpanel]') as HTMLElement).hidden).toBe(false)

    // MRU after visiting s2: s2, s4, s3 — s3 survives, s1 is still out
    act(() => tabs().activate('chat:s2'))
    expect(screen.getByTestId('probe-s2').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('probe-s3')).toBeTruthy()
    expect(screen.queryByTestId('probe-s1')).toBeNull()
    // visiting s1 evicts s3
    act(() => tabs().activate('chat:s1'))
    expect(screen.getByTestId('probe-s1').getAttribute('data-active')).toBe('true')
    expect(screen.queryByTestId('probe-s3')).toBeNull()
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(KEEP_MOUNTED)
  })

  it('guards dirty tabs with 放弃修改？ and closes only on confirm', async () => {
    render(<Workspace mac />)
    act(() => runCommand('tab.openChat', { sessionId: 's1', title: '规则 A' }))
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    expect(tabs().tabs[0]?.dirty).toBe(true)

    act(() => runCommand('tab.closeActive'))
    await settle()
    expect(screen.getByRole('dialog').textContent).toContain('放弃修改？')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await settle()
    expect(tabs().tabs).toHaveLength(1)

    act(() => runCommand('tab.closeActive'))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    await settle()
    expect(tabs().tabs).toHaveLength(0)
    expect(screen.getByTestId('workspace-empty')).toBeTruthy()
  })

  it('keeps a tab that fails to render inside its own panel and remounts it on retry', () => {
    // React reports caught render errors on console.error.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    crashing.add('s2')
    render(<Workspace mac />)
    act(() => runCommand('tab.openChat', { sessionId: 's1', title: 'A' }))
    act(() => runCommand('tab.openChat', { sessionId: 's2', title: 'B' }))

    const panel = screen.getByRole('tabpanel', { name: 'B' })
    expect(within(panel).getByRole('alert').textContent).toContain('无法显示此内容')
    // the tab strip and the other mounted tab are unaffected
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getByTestId('probe-s1')).toBeTruthy()

    crashing.delete('s2')
    fireEvent.click(within(panel).getByRole('button', { name: '重试' }))
    expect(screen.getByTestId('probe-s2').getAttribute('data-active')).toBe('true')
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  it('closes clean tabs immediately and shows an error state for unregistered kinds', () => {
    render(<Workspace mac />)
    act(() => {
      runCommand('tab.openChat', { sessionId: 's1', title: 'A' })
      tabs().open({ kind: 'diary', objectId: 'diary', title: '日记' })
    })
    expect(screen.getByText('无法显示此标签')).toBeTruthy()
    act(() => runCommand('tab.closeActive'))
    expect(tabs().tabs.map((t) => t.id)).toEqual(['chat:s1'])
    expect(mounts).toBeGreaterThan(0)
  })
})
