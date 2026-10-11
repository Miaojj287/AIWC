// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGrant } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { PermissionRulesSection } from './PermissionRulesSection'

let grants: AgentGrant[]
const revoke = vi.fn(async (req: { scope: string; key: string; threadId?: string }) => {
  grants = grants.filter((g) => !(g.key === req.key && g.scope === req.scope))
})

function mount() {
  const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['privacy:listGrants'] = async () => grants
  bridge.handlers['privacy:revokeGrant'] = revoke
  __setBridgeForTests(bridge)
  render(
    <TooltipProvider>
      <PermissionRulesSection />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  revoke.mockClear()
  grants = [
    { scope: 'global', key: 'remember' },
    { scope: 'thread', key: 'shell:git commit', threadId: 'thr_a' as never, threadTitle: '整理周报' },
  ]
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('权限规则', () => {
  it('lists what each grant allows and where', async () => {
    mount()
    expect(await screen.findByText('以「git commit」开头的命令')).toBeTruthy()
    expect(screen.getByText('工具 remember')).toBeTruthy()
    expect(screen.getByText('所有会话')).toBeTruthy()
    expect(screen.getByText('会话「整理周报」')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开会话' })).toBeTruthy()
  })

  it('labels a grant answered on the phone and revokes it without opening the thread', async () => {
    grants = [{ scope: 'thread', key: 'note_write', threadId: 'thr_p' as never, threadTitle: 'phone', phone: true }]
    mount()
    expect(await screen.findByText('手机遥控会话（我的微信）')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打开会话' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ scope: 'thread', key: 'note_write', threadId: 'thr_p' }))
  })

  it('revokes only after confirming', async () => {
    mount()
    await screen.findByText('工具 remember')
    fireEvent.click(screen.getAllByRole('button', { name: '撤销' })[0] as HTMLElement)
    expect(revoke).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ scope: 'global', key: 'remember' }))
    await waitFor(() => expect(screen.queryByText('工具 remember')).toBeNull())
  })

  it('says when there is nothing to revoke', async () => {
    grants = []
    mount()
    expect(await screen.findByText('还没有放行规则')).toBeTruthy()
  })
})
