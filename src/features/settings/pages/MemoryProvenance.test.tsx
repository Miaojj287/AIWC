// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { MemoryProvenance } from './MemoryProvenance'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('<MemoryProvenance>', () => {
  it('links each Agent-written entry back to the chat that wrote it', async () => {
    const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
    bridge.handlers['memory:entries'] = async () => [
      { index: 0, text: '周五交周报', source: 'agent', threadId: 'thr_a' },
      { index: 1, text: '用户自己写的', source: 'user' },
      { index: 2, text: '旧会话写的', source: 'agent', threadId: 'thr_gone' },
    ]
    bridge.handlers['agent:listThreads'] = () => [{ threadId: 'thr_a', title: '整理周报' } as unknown as ThreadSummary]
    __setBridgeForTests(bridge)
    render(
      <TooltipProvider>
        <MemoryProvenance file="MEMORY" />
      </TooltipProvider>,
    )
    expect(await screen.findByText('周五交周报')).toBeTruthy()
    expect(screen.queryByText('用户自己写的')).toBeNull()
    expect(await screen.findByRole('button', { name: /来自会话「整理周报」/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /来自已删除的会话/ }).hasAttribute('disabled')).toBe(true)
  })
})
