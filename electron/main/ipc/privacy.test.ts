import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { createHandlerHarness } from './testing/handlerHarness'
import { registerPrivacyIpc } from './privacy'
import type { HostBridge } from './register'

function setup() {
  const privacy = {
    grants: { list: vi.fn(async () => []), revoke: vi.fn(async () => {}), addGlobal: vi.fn() },
    permissions: { check: vi.fn(), noteHalt: vi.fn(), noteVerifiedSend: vi.fn() },
    changes: {
      list: vi.fn(() => []),
      find: vi.fn(),
      record: vi.fn(),
      undo: vi.fn(async () => ({ ok: true as const })),
    },
    dispose: vi.fn(),
  }
  const harness = createHandlerHarness()
  registerPrivacyIpc({ privacy } as unknown as AppContext, {} as HostBridge, harness.handle)
  return { harness, privacy }
}

describe('privacy IPC', () => {
  it('validates revoke requests before touching the grant service', async () => {
    const { harness, privacy } = setup()
    await harness.invoke('privacy:revokeGrant', {
      scope: 'thread',
      key: 'shell:git commit',
      threadId: 'thr_a' as never,
    })
    expect(privacy.grants.revoke).toHaveBeenCalledWith({ scope: 'thread', key: 'shell:git commit', threadId: 'thr_a' })
    expect(() => harness.invokeRaw('privacy:revokeGrant', { scope: 'everyone', key: 'x' })).toThrow()
    expect(() => harness.invokeRaw('privacy:revokeGrant', { scope: 'global', key: '../etc\n' })).toThrow()
    expect(() => harness.invokeRaw('privacy:revokeGrant', { scope: 'global', key: 'x', extra: 1 })).toThrow()
  })

  it('only accepts journal ids for undo and a thread id for listing', async () => {
    const { harness, privacy } = setup()
    await harness.invoke('privacy:undoChange', { id: 'chg_abcdef123456' })
    expect(privacy.changes.undo).toHaveBeenCalledWith('chg_abcdef123456')
    expect(() => harness.invokeRaw('privacy:undoChange', { id: '../../x' })).toThrow()
    expect(() => harness.invokeRaw('privacy:listChanges', {})).toThrow()
  })
})
