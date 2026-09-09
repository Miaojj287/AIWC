// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge, type Event, type Op, type ThreadSummary } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests } from '@/platform/configStore'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { clearToasts } from '@/kit'
import { AgentPanel } from './AgentPanel'
import { __resetAgentStoreForTests, useAgentStore } from './agentStore'
import { patchJsdomTopLayerMatches } from './testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(cleanup)

interface FakeBridge extends AiwcBridge {
  ops: Op[]
}

function fakeBridge(threads: ThreadSummary[] = []): FakeBridge {
  const listeners = new Set<(e: Event) => void>()
  const ops: Op[] = []
  return {
    runtime: 'web',
    platform: 'darwin',
    ops,
    on: ((channel: string, listener: (p: unknown) => void) => {
      if (channel === 'agent:event') listeners.add(listener as (e: Event) => void)
      return () => listeners.delete(listener as (e: Event) => void)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      switch (channel) {
        case 'config:get':
          return defaultConfig()
        case 'agent:listThreads':
          return threads
        case 'agent:getThread':
          return { summary: threads[0], items: [] }
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
const textarea = () => screen.getByRole('textbox', { name: '给 Agent 的消息' }) as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(textarea(), { target: { value, selectionStart: value.length, selectionEnd: value.length } })

beforeEach(() => {
  __resetAgentStoreForTests()
  __resetConfigStoreForTests()
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  clearToasts()
})
afterEach(() => __setBridgeForTests(undefined))

describe('<AgentPanel> composer with no open thread', () => {
  it('Enter creates a thread bound to the active workspace tab and sends the scratch draft', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    useTabsStore.getState().open({ kind: 'chat', objectId: 's9', title: '投研交流群' })
    render(<AgentPanel collapsed={false} onToggleCollapsed={() => {}} />)
    await flush()
    expect(useAgentStore.getState().activeThreadId).not.toBeNull()
    expect(bridge.ops).toEqual([])
    expect(screen.queryByText('还没有打开的会话')).toBeNull()

    type('总结今天')
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(bridge.ops.some((o) => o.type === 'turn.start')).toBe(true))

    const s = useAgentStore.getState()
    expect(s.activeThreadId).not.toBeNull()
    expect(s.threads[0]?.contextRef).toEqual({ kind: 'session', id: 's9', label: '投研交流群' })
    expect(bridge.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start'])
    const turn = bridge.ops[1]
    if (turn?.type !== 'turn.start') throw new Error()
    expect(turn.input.content).toEqual([{ type: 'text', text: '总结今天' }])
    expect(turn.input.mentions).toEqual([{ kind: 'session', id: 's9', label: '投研交流群' }])
    expect(s.drafts[s.activeThreadId!]).toEqual({ text: '', mentions: [] })
    expect(s.drafts.__scratch__ ?? { text: '', mentions: [] }).toEqual({ text: '', mentions: [] })
  })

  it('the send button follows the same path', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    render(<AgentPanel collapsed={false} onToggleCollapsed={() => {}} />)
    await flush()
    type('你好')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(bridge.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start']))
  })
})
