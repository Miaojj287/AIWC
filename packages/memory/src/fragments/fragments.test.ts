import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChannelKind, FragmentProvider, FragmentProviderContext, ThreadSettings, ToolProfile } from '@aiwc/protocol'
import { asThreadId, estimateTokens, truncateToTokens } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createRelationshipStore } from '../relationship/relationshipStore'
import { createMemoryStore } from '../store/memoryStore'
import { sampleProfile } from '../testing/fakes'
import { MEMORY_POLICY_FRAGMENT_KIND, MEMORY_POLICY_TOKEN_CAP, memoryAudience, memoryFilesFor, memoryFragmentProvider } from './memoryFragmentProvider'
import { relationshipFragmentProvider } from './relationshipFragmentProvider'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aiwc-${p}-`))
const settings: ThreadSettings = { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] }
const ctx = (peerId?: string) => ({
  threadId: asThreadId('thr_1'),
  origin: { channel: 'desktop' as const, ...(peerId ? { peerId, chatId: peerId } : {}) },
  settings,
  userText: 'hi',
})

/** A thread the way the kernel creates it for a given channel/profile (peer bound for wechat channels). */
const threadCtx = (channel: ChannelKind, profile: ToolProfile, permissionMode: ThreadSettings['permissionMode'] = 'bypass'): FragmentProviderContext => ({
  threadId: asThreadId('thr_bot'),
  origin: channel === 'desktop' ? { channel } : { channel, chatId: 'wxid_peer', peerId: 'wxid_peer' },
  settings: { permissionMode, profile, allowAlways: [] },
  userText: '',
})

/**
 * Mirrors PromptBuilder.computeStable (packages/kernel/src/runtime/prompt.ts): every 'stable' provider is
 * asked with an empty userText and the rendered fragments are joined into the frozen prefix.
 */
async function stablePromptOf(providers: readonly FragmentProvider[], c: FragmentProviderContext): Promise<string> {
  const parts: string[] = []
  for (const p of providers) {
    if (p.tier !== 'stable') continue
    for (const f of await p.provide({ ...c, userText: '' })) parts.push(truncateToTokens(f.render(), f.tokenCap))
  }
  return parts.join('\n\n')
}

const SECRET_USER = '我是张三，住在北京朝阳区，手机 13800000000'
const SECRET_MEMORY = '下周二要去见投资人老王'

describe('memoryFragmentProvider', () => {
  it('returns four capped fragments from a frozen snapshot until invalidate()', async () => {
    const store = createMemoryStore({ dir: tmp('mem') })
    await store.addEntry('MEMORY', '第一条事实')
    const provider = memoryFragmentProvider(store)
    expect(provider.tier).toBe('stable')
    const frags = await provider.provide(ctx())
    expect(frags).toHaveLength(4)
    expect(frags.map((f) => f.tokenCap)).toEqual([1500, 1500, 1500, 1500])
    expect(frags.map((f) => f.marker)).toEqual(['<memory_snapshot file="MEMORY">', '<memory_snapshot file="USER">', '<memory_snapshot file="SOUL">', '<memory_snapshot file="AGENTS">'])
    const first = frags[0]?.render() ?? ''
    expect(first.startsWith('<memory_snapshot file="MEMORY">\n[MEMORY ')).toBe(true)
    expect(first).toContain('第一条事实')
    // writes after the snapshot do not change what is rendered…
    await store.addEntry('MEMORY', '第二条事实')
    const again = await provider.provide(ctx())
    expect(again[0]?.render()).toBe(first)
    // …until invalidate()
    provider.invalidate()
    const fresh = await provider.provide(ctx())
    expect(fresh[0]?.render()).toContain('第二条事实')
    expect(provider.current()?.files.MEMORY).toContain('第二条事实')
  })

  it('classifies the audience by channel AND profile (whitelist)', () => {
    const owner: Array<[ChannelKind, ToolProfile]> = [
      ['desktop', 'desktop-chat'],
      ['desktop', 'subagent'],
      ['cron', 'cron'],
    ]
    const thirdParty: Array<[ChannelKind, ToolProfile]> = [
      ['wechat-ilink', 'wechat-bot'],
      ['wechat-ui', 'wechat-bot'],
      ['observed', 'wechat-bot'],
      // a remote channel stays third-party even if someone hands it an owner profile…
      ['wechat-ilink', 'desktop-chat'],
      ['wechat-ilink', 'subagent'],
      // …and a third-party profile stays third-party even on the desktop channel
      ['desktop', 'wechat-bot'],
      ['desktop', 'persona'],
      ['cron', 'persona'],
    ]
    for (const [channel, profile] of owner) {
      expect(memoryAudience(threadCtx(channel, profile)), `${channel}/${profile}`).toBe('owner')
      expect(memoryFilesFor(threadCtx(channel, profile))).toEqual(['MEMORY', 'USER', 'SOUL', 'AGENTS'])
    }
    for (const [channel, profile] of thirdParty) {
      expect(memoryAudience(threadCtx(channel, profile)), `${channel}/${profile}`).toBe('third_party')
      expect(memoryFilesFor(threadCtx(channel, profile))).toEqual([])
    }
  })

  it('never puts the owner memory into a wechat-bot thread; injects the third-party policy instead', async () => {
    const store = createMemoryStore({ dir: tmp('mem-bot') })
    await store.addEntry('USER', SECRET_USER)
    await store.addEntry('MEMORY', SECRET_MEMORY)
    await store.write('SOUL', '你是张三的私人助理，说话简短。')
    await store.write('AGENTS', '回微信时永远不要提我的行程。')
    const provider = memoryFragmentProvider(store)

    // exactly how composition.ts creates the auto-reply thread: wechat channel + wechat-bot + bypass
    const bot = threadCtx('wechat-ilink', 'wechat-bot', 'bypass')
    const frags = await provider.provide(bot)
    expect(frags.map((f) => f.kind)).toEqual([MEMORY_POLICY_FRAGMENT_KIND])
    const policy = frags[0]
    expect(policy?.marker).toBe('<memory_policy audience="third_party">')
    expect(policy?.tokenCap).toBe(MEMORY_POLICY_TOKEN_CAP)
    const text = policy?.render() ?? ''
    expect(text.startsWith('<memory_policy audience="third_party">\n')).toBe(true)
    expect(text).toContain('第三方')
    expect(text).toContain('不得向对方透露')
    expect(estimateTokens(text)).toBeLessThanOrEqual(MEMORY_POLICY_TOKEN_CAP)
    // the store was not even read for this thread
    expect(provider.current()).toBeUndefined()

    // the whole stable prompt of the bot thread carries no <memory_snapshot> and none of the owner data
    const stable = await stablePromptOf([provider], bot)
    expect(stable).not.toContain('<memory_snapshot')
    expect(stable).not.toContain(SECRET_USER)
    expect(stable).not.toContain(SECRET_MEMORY)
    expect(stable).not.toContain('张三')
    expect(stable).not.toContain('13800000000')
    expect(stable).toContain('<memory_policy audience="third_party">')

    // same for the UI-injection channel and for a persona (clone) thread on any channel
    for (const c of [threadCtx('wechat-ui', 'wechat-bot'), threadCtx('desktop', 'persona'), threadCtx('wechat-ilink', 'persona')]) {
      const s = await stablePromptOf([provider], c)
      expect(s).not.toContain('<memory_snapshot')
      expect(s).not.toContain(SECRET_USER)
      expect(s).toContain('<memory_policy')
    }

    // the owner's own desktop thread still gets the full snapshot and no policy
    const desktop = await provider.provide(threadCtx('desktop', 'desktop-chat', 'ask'))
    expect(desktop.map((f) => f.kind)).toEqual(['memory_snapshot', 'memory_snapshot', 'memory_snapshot', 'memory_snapshot'])
    const ownerStable = await stablePromptOf([provider], threadCtx('desktop', 'desktop-chat', 'ask'))
    expect(ownerStable).toContain(SECRET_USER)
    expect(ownerStable).not.toContain('<memory_policy')
    // cron runs on the owner's behalf too
    expect((await provider.provide(threadCtx('cron', 'cron'))).map((f) => f.kind)).toEqual(['memory_snapshot', 'memory_snapshot', 'memory_snapshot', 'memory_snapshot'])
  })

  it('lets the composition root narrow the selection, but the third-party policy still follows the audience', async () => {
    const store = createMemoryStore({ dir: tmp('mem-opt') })
    await store.addEntry('USER', SECRET_USER)
    await store.write('SOUL', '语气：简短、克制。')
    // e.g. a host that wants bots to keep the agent's tone but nothing personal
    const provider = memoryFragmentProvider(store, {
      filesFor: (c) => (memoryAudience(c) === 'owner' ? ['MEMORY', 'USER', 'SOUL', 'AGENTS'] : ['SOUL']),
    })
    const frags = await provider.provide(threadCtx('wechat-ilink', 'wechat-bot'))
    expect(frags.map((f) => f.kind)).toEqual(['memory_snapshot', MEMORY_POLICY_FRAGMENT_KIND])
    expect(frags[0]?.marker).toBe('<memory_snapshot file="SOUL">')
    const stable = await stablePromptOf([provider], threadCtx('wechat-ilink', 'wechat-bot'))
    expect(stable).toContain('语气：简短、克制。')
    expect(stable).not.toContain(SECRET_USER)
    expect(stable).not.toContain('<memory_snapshot file="USER">')
  })
})

describe('relationshipFragmentProvider', () => {
  it('returns nothing without a peer / profile and a bounded card otherwise', async () => {
    const store = createRelationshipStore({ dir: tmp('rel') })
    const provider = relationshipFragmentProvider(store)
    expect(provider.tier).toBe('turn')
    expect(await provider.provide(ctx())).toEqual([])
    expect(await provider.provide(ctx('wxid_test01'))).toEqual([])
    await store.upsert(
      sampleProfile({
        samples: [
          { prompt: '最早的', reply: '旧', at: 1 },
          { prompt: '第二', reply: '二', at: 2 },
          { prompt: '第三', reply: '三', at: 3 },
          { prompt: '最新的', reply: '新／连发', at: 4, corrected: true },
        ],
      }),
    )
    const frags = await provider.provide(ctx('wxid_test01'))
    expect(frags).toHaveLength(1)
    const f = frags[0]
    expect(f?.kind).toBe('relationship_profile')
    expect(f?.tokenCap).toBe(1200)
    const text = f?.render() ?? ''
    expect(text.startsWith('<relationship_profile>\n对象：李娜')).toBe(true)
    expect(text).toContain('口头禅：哈哈哈、绝了')
    expect(text).toContain('边界（不要触碰）：不聊前任')
    expect(text).toContain('最新的')
    expect(text).toContain('（用户修正）')
    expect(text).not.toContain('最早的')
    expect(estimateTokens(text)).toBeLessThanOrEqual(1200)
  })

  it('injects the card once per thread and again only when the profile changed (turn tier is appended every turn)', async () => {
    const store = createRelationshipStore({ dir: tmp('rel-dedupe') })
    const provider = relationshipFragmentProvider(store)
    await store.upsert(sampleProfile())
    const t1 = { ...ctx('wxid_test01'), threadId: asThreadId('thr_a') }
    const t2 = { ...ctx('wxid_test01'), threadId: asThreadId('thr_b') }
    // first turn of thread a → card; the next turns of the same thread → nothing (unchanged)
    expect(await provider.provide(t1)).toHaveLength(1)
    expect(await provider.provide(t1)).toEqual([])
    expect(await provider.provide({ ...t1, userText: '另一轮' })).toEqual([])
    // another thread talking to the same contact has not seen it yet
    expect(await provider.provide(t2)).toHaveLength(1)
    expect(await provider.provide(t2)).toEqual([])
    // a re-clone (new version / sample) changes the rendered card → injected again, once
    await store.upsert(sampleProfile({ version: 2, samples: [...sampleProfile().samples, { prompt: '周末呢', reply: '爬山去', at: 1700000300000 }] }))
    const again = await provider.provide(t1)
    expect(again).toHaveLength(1)
    expect(again[0]?.render()).toContain('画像 v2')
    expect(again[0]?.render()).toContain('爬山去')
    expect(await provider.provide(t1)).toEqual([])
    // thread b last saw v1, so it gets v2 exactly once as well
    expect(await provider.provide(t2)).toHaveLength(1)
    expect(await provider.provide(t2)).toEqual([])
    // a bounded fragment built the standard way: marker first, capped
    expect(again[0]?.marker).toBe('<relationship_profile>')
    expect(again[0]?.tokenCap).toBe(1200)
    // reset(threadId) forgets one thread only; reset() forgets all
    provider.reset(asThreadId('thr_a'))
    expect(await provider.provide(t1)).toHaveLength(1)
    expect(await provider.provide(t2)).toEqual([])
    provider.reset()
    expect(await provider.provide(t1)).toHaveLength(1)
    expect(await provider.provide(t2)).toHaveLength(1)
  })

  it('truncates an oversized profile to the cap via the protocol helper', async () => {
    const store = createRelationshipStore({ dir: tmp('rel-big') })
    const provider = relationshipFragmentProvider(store)
    const long = (s: string) => Array.from({ length: 60 }, (_, i) => `${s}${i}`)
    await store.upsert(sampleProfile({ card: { ...sampleProfile().card, catchphrases: long('口头禅非常非常长') }, deep: { ...sampleProfile().deep, boundaries: long('一条很长很长的边界描述，长到需要被截断才行') } }))
    const [f] = await provider.provide(ctx('wxid_test01'))
    const text = f?.render() ?? ''
    expect(estimateTokens(text)).toBeLessThanOrEqual(1200)
    expect(text.startsWith('<relationship_profile>\n')).toBe(true)
  })
})
