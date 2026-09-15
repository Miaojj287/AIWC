import { describe, expect, it } from 'vitest'
import { ProviderSchema, defaultConfig, type AppConfig } from '@aiwc/protocol'
import { createModelResolver } from './modelResolver'

const cloud = ProviderSchema.parse({
  id: 'cloud',
  kind: 'openai',
  label: 'Cloud',
  apiKeyRef: 'ai:cloud',
  models: [{ modelId: 'gpt', label: 'GPT' }],
})
const local = ProviderSchema.parse({
  id: 'ollama',
  kind: 'ollama',
  label: 'Ollama',
  models: [
    { modelId: 'qwen', label: 'Qwen' },
    { modelId: 'retired', label: 'Retired', enabled: false },
  ],
})

function setup(): ReturnType<typeof createModelResolver> {
  const base = defaultConfig()
  const config: AppConfig = {
    ...base,
    ai: { ...base.ai, providers: [cloud, local], defaultModel: { providerId: 'cloud', modelId: 'gpt' } },
  }
  return createModelResolver({ config: () => config, secrets: { reveal: () => 'sk-test' } })
}

describe('model resolver locality', () => {
  it('keeps internal calls for a local thread on its own local model', async () => {
    const auxiliary = await setup().resolveAuxiliary({ providerId: 'ollama', modelId: 'qwen' })
    expect(auxiliary.ref).toMatchObject({ providerId: 'ollama', modelId: 'qwen' })
  })

  it('uses the default model for internal calls of online or default threads', async () => {
    const resolver = setup()
    expect((await resolver.resolveAuxiliary()).ref).toMatchObject({ providerId: 'cloud', modelId: 'gpt' })
    expect((await resolver.resolveAuxiliary({ providerId: 'cloud', modelId: 'gpt' })).ref).toMatchObject({
      providerId: 'cloud',
    })
  })

  it('refuses to move a thread from an unusable local model to the online default', async () => {
    await expect(setup().resolve({ providerId: 'ollama', modelId: 'retired' })).rejects.toThrow()
  })

  it('falls back to the default only when the unusable selection was not local', async () => {
    const client = await setup().resolve({ providerId: 'cloud', modelId: 'gone' })
    expect(client.ref).toMatchObject({ providerId: 'cloud', modelId: 'gpt' })
  })
})
