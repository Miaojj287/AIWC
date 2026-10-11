import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '@aiwc/protocol'
import { ensureEnabledModel, firstUsableModelId } from './modelSetup'

const provider = (models: Array<{ id: string; enabled?: boolean; available?: boolean }>): ProviderConfig => ({
  id: 'p',
  kind: 'openai-compatible',
  label: 'P',
  models: models.map((m) => ({
    modelId: m.id,
    label: m.id,
    contextWindow: 1000,
    supportsTools: true,
    supportsVision: false,
    enabled: m.enabled ?? true,
    available: m.available,
  })),
})

describe('model setup step', () => {
  it('enables the first offered model when the dialog left all of them off', () => {
    const next = ensureEnabledModel(
      provider([
        { id: 'gone', enabled: false, available: false },
        { id: 'a', enabled: false },
        { id: 'b', enabled: false },
      ]),
    )
    expect(next.models.map((m) => m.enabled)).toEqual([false, true, false])
    expect(firstUsableModelId(next)).toBe('a')
  })
  it('leaves a provider that already has a usable model alone', () => {
    const p = provider([{ id: 'a', enabled: false }, { id: 'b' }])
    expect(ensureEnabledModel(p)).toBe(p)
  })
})
