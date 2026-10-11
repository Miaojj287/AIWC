import { describe, expect, it, vi } from 'vitest'
import { AppConfigSchema } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { createHandlerHarness } from './testing/handlerHarness'
import { registerAiIpc } from './ai'
import { registerConfigIpc } from './config'
import type { HostBridge } from './register'

function setup() {
  const vault = new Map<string, string>([
    ['mobile.ilink.session', '{"token":"t"}'],
    ['account.dbKey', 'ab'.repeat(32)],
    ['provider:deepseek:apiKey', 'sk-test'],
  ])
  const secrets = {
    set: vi.fn((ref: string, value: string) => void vault.set(ref, value)),
    has: (ref: string) => vault.has(ref),
    reveal: (ref: string) => vault.get(ref) ?? null,
    delete: vi.fn((ref: string) => void vault.delete(ref)),
  }
  const config = { get: () => AppConfigSchema.parse({}), set: vi.fn(() => AppConfigSchema.parse({})) }
  const harness = createHandlerHarness()
  registerConfigIpc(
    { secrets, config, allowList: {}, paths: {} } as unknown as AppContext,
    {} as HostBridge,
    harness.handle,
  )
  return { harness, vault, secrets, config }
}

describe('config IPC · secrets', () => {
  it('serves the refs the settings pages use', () => {
    const { harness, vault } = setup()
    harness.invoke('secret:set', { ref: 'provider:deepseek:apiKey', value: 'sk-new' })
    expect(vault.get('provider:deepseek:apiKey')).toBe('sk-new')
    expect(harness.invoke('secret:has', { ref: 'ai.proxy.password' })).toBe(false)
    expect(harness.invoke('secret:reveal', { ref: 'account.dbKey' })).toBe('ab'.repeat(32))
    harness.invoke('secret:delete', { ref: 'ai.jev.apiKey' })
  })

  it('never reads, replaces or deletes the iLink session (it decides who the owner is)', () => {
    const { harness, vault, secrets } = setup()
    expect(() => harness.invoke('secret:reveal', { ref: 'mobile.ilink.session' })).toThrow()
    expect(() => harness.invoke('secret:set', { ref: 'mobile.ilink.session', value: '{}' })).toThrow()
    expect(() => harness.invoke('secret:delete', { ref: 'mobile.ilink.session' })).toThrow()
    expect(() => harness.invoke('secret:has', { ref: 'mcp.files.TOKEN' })).toThrow()
    expect(secrets.set).not.toHaveBeenCalled()
    expect(secrets.delete).not.toHaveBeenCalled()
    expect(vault.get('mobile.ilink.session')).toBe('{"token":"t"}')
  })

  it('does not hand an API key back in clear', () => {
    const { harness } = setup()
    expect(() => harness.invoke('secret:reveal', { ref: 'provider:deepseek:apiKey' })).toThrow()
  })

  it('refuses a config patch that points a provider key at a main-only secret', () => {
    const { harness, config } = setup()
    const provider = { id: 'evil', kind: 'openai-compatible' as const, label: 'x', models: [] }
    expect(() =>
      harness.invoke('config:set', { ai: { providers: [{ ...provider, apiKeyRef: 'mobile.ilink.session' }] } }),
    ).toThrow()
    expect(config.set).not.toHaveBeenCalled()
    harness.invoke('config:set', { ai: { providers: [{ ...provider, apiKeyRef: 'provider:evil:apiKey' }] } })
    expect(config.set).toHaveBeenCalledTimes(1)
  })

  it('refuses an ai:* request whose provider names a secret other than a provider key', () => {
    const reveal = vi.fn(() => 'secret')
    const harness = createHandlerHarness()
    registerAiIpc(
      {
        secrets: { reveal },
        logger: { child: () => ({ debug: () => {}, warn: () => {} }) },
        modelOps: { fetchFor: () => fetch },
      } as unknown as AppContext,
      {} as HostBridge,
      harness.handle,
    )
    const provider = {
      id: 'evil',
      kind: 'openai-compatible' as const,
      label: 'x',
      baseUrl: 'http://127.0.0.1:1',
      models: [],
    }
    for (const ref of ['mobile.ilink.session', 'account.dbKey'])
      expect(() =>
        harness.invoke('ai:testModel', { provider: { ...provider, apiKeyRef: ref }, modelId: 'm' }),
      ).toThrow()
    expect(reveal).not.toHaveBeenCalled()
  })
})
