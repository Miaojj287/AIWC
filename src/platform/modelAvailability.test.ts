import { describe, expect, it } from 'vitest'
import { hasUsableModel } from './modelAvailability'

const model = (patch: { enabled?: boolean; available?: boolean }) => ({
  modelId: 'm',
  label: 'm',
  contextWindow: 1000,
  supportsTools: true,
  supportsVision: false,
  enabled: patch.enabled ?? true,
  available: patch.available,
})

describe('hasUsableModel', () => {
  it('needs an enabled model the endpoint still offers', () => {
    expect(hasUsableModel(undefined)).toBe(false)
    expect(hasUsableModel([{ models: [] }])).toBe(false)
    expect(hasUsableModel([{ models: [model({ enabled: false })] }])).toBe(false)
    expect(hasUsableModel([{ models: [model({ available: false })] }])).toBe(false)
    expect(hasUsableModel([{ models: [model({ enabled: false }), model({})] }])).toBe(true)
  })
})
