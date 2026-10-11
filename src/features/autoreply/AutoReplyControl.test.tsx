// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutoSendPermissions, InvokeRes } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { AutoReplyControl } from './AutoReplyControl'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

function mount(status: Partial<InvokeRes<'autoreply:status'>>, permissions: Partial<AutoSendPermissions>) {
  const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  const opened: string[] = []
  bridge.handlers['autoreply:status'] = () => ({
    connection: 'ready',
    demo: false,
    queued: 0,
    generating: [],
    ...status,
  })
  bridge.handlers['privacy:autoSendPermissions'] = () => ({
    platform: 'darwin',
    accessibility: 'granted',
    automation: 'granted',
    ready: true,
    checkedAt: 0,
    ...permissions,
  })
  bridge.handlers['app:openUrl'] = async ({ url }) => void opened.push(url)
  __setBridgeForTests(bridge)
  render(
    <TooltipProvider>
      <AutoReplyControl />
    </TooltipProvider>,
  )
  return opened
}

describe('<AutoReplyControl>', () => {
  it('offers the Automation pane for an automation halt, by its code', async () => {
    const opened = mount({ halted: 'whatever text', haltCode: 'automation-denied' }, {})
    fireEvent.click(await screen.findByRole('button', { name: '打开「自动化」设置' }))
    expect(screen.queryByRole('button', { name: '打开「辅助功能」设置' })).toBeNull()
    await Promise.resolve()
    expect(opened[0]).toContain('Privacy_Automation')
  })

  it('shows a grant invalidated by an update with how to fix it', async () => {
    mount({}, { accessibility: 'stale', ready: false })
    expect(await screen.findByText('需要重新授权')).toBeTruthy()
    expect(screen.getByText(/先用「−」移除 AIWC/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开系统设置' })).toBeTruthy()
  })

  it('renders nothing when sending is unobstructed', async () => {
    mount({}, {})
    await Promise.resolve()
    expect(screen.queryByText('自动发送需要的系统权限')).toBeNull()
  })
})
