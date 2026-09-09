import { describe, expect, it } from 'vitest'
import { createFragment } from '@aiwc/protocol'
import type { FragmentProvider } from '../ports'
import { PromptBuilder, STABLE_BUILD_MAX_ATTEMPTS } from './prompt'
import { createFakeSkillIndex, testOrigin, testSettings, testThreadId } from './testing/fakes'

const ctx = { threadId: testThreadId(), origin: testOrigin(), settings: testSettings() }
const memory = createFragment('memory_snapshot', '<memory_snapshot>', 500, () => '用户叫小明。')

function flakyProvider(failures: number): FragmentProvider & { calls: number } {
  const p = {
    tier: 'stable' as const,
    calls: 0,
    async provide() {
      p.calls++
      if (p.calls <= failures) throw new Error(`memory unavailable #${p.calls}`)
      return [memory]
    },
  }
  return p
}

describe('PromptBuilder — stable tier', () => {
  it('(9) a failing stable provider is retried on later builds instead of freezing a memory-less prompt', async () => {
    const provider = flakyProvider(2)
    const errors: unknown[] = []
    const b = new PromptBuilder({ stable: '身份', skills: createFakeSkillIndex(), fragmentProviders: [provider], onError: (e) => errors.push(e) })
    expect((await b.stablePrompt(ctx)).text).not.toContain('小明')
    expect((await b.stablePrompt(ctx)).text).not.toContain('小明')
    const third = await b.stablePrompt(ctx)
    expect(third.text).toContain('小明')
    expect(b.stableBuildAttempts).toBe(3)
    // frozen from here on
    expect(await b.stablePrompt(ctx)).toBe(third)
    expect(provider.calls).toBe(3)
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('freezes the degraded prompt after STABLE_BUILD_MAX_ATTEMPTS and logs it', async () => {
    const provider = flakyProvider(Number.POSITIVE_INFINITY)
    const errors: unknown[] = []
    const b = new PromptBuilder({ stable: '身份', skills: createFakeSkillIndex(), fragmentProviders: [provider], onError: (e) => errors.push(e) })
    for (let i = 0; i < STABLE_BUILD_MAX_ATTEMPTS + 3; i++) await b.stablePrompt(ctx)
    expect(b.stableBuildAttempts).toBe(STABLE_BUILD_MAX_ATTEMPTS)
    expect(provider.calls).toBe(STABLE_BUILD_MAX_ATTEMPTS)
    expect(errors.some((e) => String(e).includes('frozen'))).toBe(true)
  })

  it('concurrent callers of a failing build share it and the next call retries', async () => {
    const provider = flakyProvider(1)
    const b = new PromptBuilder({ stable: '身份', skills: createFakeSkillIndex(), fragmentProviders: [provider] })
    const [x, y] = await Promise.all([b.stablePrompt(ctx), b.stablePrompt(ctx)])
    expect(x).toBe(y)
    expect(provider.calls).toBe(1)
    expect((await b.stablePrompt(ctx)).text).toContain('小明')
    expect(provider.calls).toBe(2)
  })
})
