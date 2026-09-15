// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultConfig,
  type AiwcBridge,
  type AppConfig,
  type ConfigPatch,
  type Event,
  type Op,
  type ThreadId,
  type ThreadSummary,
} from '@aiwc/protocol'
import { onCommand, runCommand } from '@/app/commands'
import { clearToasts, TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { registerTab, type TabRendererProps } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { __resetAgentStoreForTests, useAgentStore } from '../agentStore'
import { patchJsdomTopLayerMatches } from '../testUtils'
import { AgentWindow } from './AgentWindow'
import { __resetAgentWindowStoreForTests } from './agentWindowStore'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

function Probe({ tab }: TabRendererProps) {
  return <div data-testid={`probe-${tab.objectId}`}>{tab.title}</div>
}
registerTab({ kind: 'chat', icon: 'message-square', component: Probe })

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }
const DAY = 86_400_000
/** `n` days old; `n = 0` is "now". */
const thread = (n: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: `thr_${n}` as ThreadId,
  title: `会话 ${n}`,
  origin: { channel: 'desktop' },
  settings,
  createdAt: Date.now() - n * DAY,
  updatedAt: Date.now() - n * DAY,
  pinned: false,
  ...patch,
})

interface FakeBridge extends AiwcBridge {
  ops: Op[]
  writes: ConfigPatch[]
}

function fakeBridge(threads: ThreadSummary[]): FakeBridge {
  const listeners = new Set<(e: Event) => void>()
  const ops: Op[] = []
  const writes: ConfigPatch[] = []
  const base = defaultConfig()
  let config: AppConfig = { ...base, ui: { ...base.ui, shellMode: 'agent' } }
  return {
    runtime: 'web',
    platform: 'darwin',
    ops,
    writes,
    on: ((channel: string, listener: (p: unknown) => void) => {
      if (channel === 'agent:event') listeners.add(listener as (e: Event) => void)
      return () => listeners.delete(listener as (e: Event) => void)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      switch (channel) {
        case 'config:get':
          return config
        case 'config:set': {
          const patch = req as ConfigPatch
          writes.push(patch)
          config = { ...config, ui: { ...config.ui, ...patch.ui } }
          return config
        }
        case 'agent:listThreads':
          return threads
        case 'agent:getThread': {
          const { threadId } = req as { threadId: ThreadId }
          return { summary: threads.find((t) => t.threadId === threadId) ?? threads[0], items: [] }
        }
        case 'agent:submit':
          ops.push(req as Op)
          return undefined
        case 'agent:listModels':
        case 'agent:listSkills':
        case 'agent:suggestPrompts':
          return []
        default:
          throw new Error(`unexpected ${channel}`)
      }
    }) as AiwcBridge['invoke'],
  }
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

async function mount(threads: ThreadSummary[]) {
  const bridge = fakeBridge(threads)
  __setBridgeForTests(bridge)
  await useConfigStore.getState().hydrate()
  render(
    <TooltipProvider>
      <AgentWindow platform="darwin" runtime="web" />
    </TooltipProvider>,
  )
  await flush()
  return bridge
}

const threadList = () => screen.getByRole('list', { name: '会话列表' })
const paneToggle = () => screen.getByTestId('agent-window-pane-toggle') as HTMLButtonElement

beforeEach(() => {
  __resetAgentStoreForTests()
  __resetConfigStoreForTests()
  __resetShellStoreForTests()
  __resetAgentWindowStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {}, openSeq: 0 })
  clearToasts()
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('<AgentWindow>', () => {
  it('lists threads in the sidebar by group and switches the conversation on click', async () => {
    await mount([thread(0), thread(1, { pinned: true, title: '固定的' }), thread(10)])
    const list = threadList()
    for (const heading of ['固定', '今天', '昨天', '更早']) expect(within(list).getByText(heading)).toBeTruthy()
    fireEvent.click(list.querySelector('[data-thread-id="thr_10"]')!)
    expect(useAgentStore.getState().activeThreadId).toBe('thr_10')
    await waitFor(() => expect(document.title).toContain('会话 10'))
  })

  it('「工作台」 returns to the four-column layout through shell.setMode', async () => {
    await mount([thread(0)])
    const seen: unknown[] = []
    const off = onCommand('shell.setMode', (p) => seen.push(p))
    fireEvent.click(screen.getByRole('button', { name: '工作台' }))
    off()
    expect(seen).toEqual([{ mode: 'workbench' }])
  })

  it('reveals the workspace pane when a tab opens, hides it on demand, and drops it with the last tab', async () => {
    await mount([thread(0)])
    const pane = screen.getByTestId('agent-window-pane')
    expect(pane.hidden).toBe(true)
    expect(paneToggle().disabled).toBe(true)

    act(() => runCommand('tab.openChat', { sessionId: 's1', title: '产品群' }))
    expect(pane.hidden).toBe(false)
    expect(within(pane).getByTestId('probe-s1')).toBeTruthy()

    fireEvent.click(paneToggle())
    expect(pane.hidden).toBe(true)
    // re-opening the same (already active) tab must bring the pane back
    act(() => runCommand('tab.openChat', { sessionId: 's1', title: '产品群' }))
    expect(pane.hidden).toBe(false)

    act(() => useTabsStore.getState().close('chat:s1'))
    expect(pane.hidden).toBe(true)
    expect(paneToggle().disabled).toBe(true)
  })

  it('closing the last open thread opens a fresh one instead of collapsing the Agent', async () => {
    await mount([thread(0)])
    let collapsed = 0
    const off = onCommand('agent.toggleCollapsed', () => {
      collapsed++
    })
    const before = useAgentStore.getState().activeThreadId
    expect(before).toBe('thr_0')
    act(() => useAgentStore.getState().closeThread(before!))
    await flush()
    off()
    expect(collapsed).toBe(0)
    const after = useAgentStore.getState().activeThreadId
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })

  it('⌘K (search.sessions) focuses the sidebar search; ⌘⇧J and ⌘1–4 return to the workbench', async () => {
    await mount([thread(0)])
    act(() => runCommand('search.sessions'))
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索会话…' }))

    const seen: unknown[] = []
    const off = onCommand('shell.setMode', (p) => seen.push(p))
    act(() => runCommand('agent.toggleCollapsed'))
    act(() => runCommand('rail.select', { fn: 'tasks' }))
    off()
    expect(seen).toEqual([{ mode: 'workbench' }, { mode: 'workbench' }])
  })

  it('offers every panel action on a sidebar row: open / rename / pin / export / compact / clear / delete', async () => {
    await mount([thread(0), thread(1)])
    fireEvent.contextMenu(threadList().querySelector('[data-thread-id="thr_1"]')!)
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      '打开会话',
      '重命名',
      '固定会话',
      '导出对话',
      expect.stringContaining('压缩上下文'),
      '清空上下文',
      '删除会话',
    ])
    expect(items.at(-1)?.className).toContain('danger')
  })

  it('sends from the composer with the same ops as the panel (thread.create → turn.start)', async () => {
    const bridge = await mount([])
    const textarea = screen.getByRole('textbox', { name: '给 Agent 的消息' }) as HTMLTextAreaElement
    const value = '总结今天'
    fireEvent.change(textarea, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(bridge.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start']))
    expect(within(threadList()).getByText('总结今天')).toBeTruthy()
  })
})
