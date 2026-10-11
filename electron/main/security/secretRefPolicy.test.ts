import { describe, expect, it } from 'vitest'
import { PROXY_PASSWORD_SECRET_REF } from '@aiwc/protocol'
import { SECRET_REFS } from '../config/secretStore'
import {
  isProviderKeyRef,
  isRendererSecretRef,
  isRevealableSecretRef,
  refusedSecretRefInPatch,
} from './secretRefPolicy'

describe('secret ref policy', () => {
  it('lets the renderer manage provider keys, the Jev key, the proxy password and the account keys', () => {
    for (const ref of [
      'provider:deepseek:apiKey',
      'provider:custom-1:apiKey',
      SECRET_REFS.providerApiKey('openai'),
      SECRET_REFS.jevApiKey,
      PROXY_PASSWORD_SECRET_REF,
      SECRET_REFS.dbKey,
      'account:imageAesKey',
    ])
      expect(isRendererSecretRef(ref), ref).toBe(true)
  })

  it('refuses main-only refs: the iLink session, MCP secrets, anything unknown', () => {
    for (const ref of ['mobile.ilink.session', 'mcp.files.TOKEN', 'provider:x', 'ai.provider..apiKey', '', 42, null])
      expect(isRendererSecretRef(ref), String(ref)).toBe(false)
  })

  it('reveals only the account keys in clear', () => {
    expect(isRevealableSecretRef(SECRET_REFS.dbKey)).toBe(true)
    expect(isRevealableSecretRef('account:imageXorKey')).toBe(true)
    expect(isRevealableSecretRef('provider:deepseek:apiKey')).toBe(false)
    expect(isRevealableSecretRef('mobile.ilink.session')).toBe(false)
  })

  it('lets each config field point only at its own kind of secret', () => {
    const ok = {
      ai: { providers: [{ apiKeyRef: 'provider:a:apiKey' }, {}], jev: { apiKeyRef: SECRET_REFS.jevApiKey } },
      account: { dbKeyRef: SECRET_REFS.dbKey, imageAesKeyRef: 'account:imageAesKey' },
    }
    expect(refusedSecretRefInPatch(ok)).toBeUndefined()
    expect(refusedSecretRefInPatch({ ai: { providers: [{ apiKeyRef: 'mobile.ilink.session' }] } })).toBe(
      'mobile.ilink.session',
    )
    expect(refusedSecretRefInPatch({ ai: { providers: [{ apiKeyRef: SECRET_REFS.dbKey }] } })).toBe(SECRET_REFS.dbKey)
    expect(refusedSecretRefInPatch({ ai: { jev: { apiKeyRef: 'mcp.files.TOKEN' } } })).toBe('mcp.files.TOKEN')
    expect(refusedSecretRefInPatch({ account: { dbKeyRef: 'provider:a:apiKey' } })).toBe('provider:a:apiKey')
    expect(refusedSecretRefInPatch({ general: { language: 'en-US' } })).toBeUndefined()
    expect(isProviderKeyRef('provider:a:apiKey')).toBe(true)
    expect(isProviderKeyRef(SECRET_REFS.jevApiKey)).toBe(false)
  })
})
