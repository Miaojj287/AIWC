import type { ContextFragment, MessageEvent, ThreadOrigin, ThreadSettings, ToastPayload } from '@aiwc/protocol'
import { createObservedBuffer } from '@aiwc/gateway'
import { describe, expect, it } from 'vitest'
import { dateHook, formatChineseDate, memoryToastHook } from '../hooks'
import { observedFragmentProvider, userInstructionsFragmentProvider, wireMemoryInvalidation } from './fragments'

const settings: ThreadSettings = { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] }
const ctx = (origin: ThreadOrigin) => ({ threadId: 't' as never, origin, settings, userText: 'hi' })

describe('host fragments', () => {
  it('renders AGENTS.md as a bounded turn-tier fragment and nothing when empty', async () => {
    const p = userInstructionsFragmentProvider({ read: async () => '  \n' })
    expect(p.tier).toBe('turn')
    expect(await p.provide(ctx({ channel: 'desktop' }))).toEqual([])
    const q = userInstructionsFragmentProvider({ read: async () => '§ 回复要简短' })
    const [frag] = await q.provide(ctx({ channel: 'desktop' }))
    expect(frag?.kind).toBe('user_instructions')
    expect(frag?.tokenCap).toBeLessThanOrEqual(10_000)
    expect(frag?.render()).toContain('回复要简短')
    expect(frag?.render().startsWith('<user_instructions>')).toBe(true)
  })

  it('replays observed context only for wechat threads bound to a chat', async () => {
    const frag: ContextFragment = { kind: 'observed_context', marker: '<observed>', tokenCap: 100, render: () => '<observed>x' }
    const calls: string[] = []
    const p = observedFragmentProvider({ observed: { take: () => [], fragment: (id) => (calls.push(id), id === 'g1' ? frag : undefined) } })
    expect(await p.provide(ctx({ channel: 'desktop', chatId: 'g1' }))).toEqual([])
    expect(await p.provide(ctx({ channel: 'wechat-ilink' }))).toEqual([])
    expect(await p.provide(ctx({ channel: 'wechat-ilink', chatId: 'g1' }))).toEqual([frag])
    expect(await p.provide(ctx({ channel: 'wechat-ui', chatId: 'g2' }))).toEqual([])
    expect(calls).toEqual(['g1', 'g2'])
  })

  it('drains observed chatter after injecting it: two addressed turns with no new chatter record one fragment', async () => {
    const buf = createObservedBuffer({ now: () => 2_000_000 })
    const chatter = (id: string, text: string): MessageEvent => ({
      id,
      kind: 'text',
      text,
      timestamp: 1_000_000,
      addressed: false,
      source: { channel: 'wechat-ilink', peerId: 'u1', chatId: 'g1', chatType: 'group', displayName: 'User1' },
    })
    buf.push(chatter('m1', '第一条'))
    buf.push(chatter('m2', '第二条'))
    const p = observedFragmentProvider({ observed: buf })
    const origin: ThreadOrigin = { channel: 'wechat-ilink', chatId: 'g1', peerId: 'u1' }

    const first = await p.provide(ctx(origin))
    expect(first).toHaveLength(1)
    const rendered = first[0]!.render()
    expect(rendered).toContain('第一条')
    expect(rendered).toContain('第二条')
    // the snapshot survives the drain (it is what gets recorded into history)…
    expect(buf.size('g1')).toBe(0)
    expect(first[0]!.render()).toBe(rendered)
    // …and the next addressed turn with no new chatter injects nothing
    expect(await p.provide(ctx(origin))).toEqual([])
    // new chatter after the drain is injected once, without the old lines
    buf.push(chatter('m3', '第三条'))
    const third = await p.provide(ctx(origin))
    expect(third).toHaveLength(1)
    expect(third[0]!.render()).toContain('第三条')
    expect(third[0]!.render()).not.toContain('第一条')
    expect(await p.provide(ctx(origin))).toEqual([])
  })

  it('wireMemoryInvalidation drops the frozen memory snapshot on every store change until unsubscribed', () => {
    const listeners = new Set<(e: { file: 'MEMORY'; source: 'user' }) => void>()
    let invalidated = 0
    const off = wireMemoryInvalidation(
      {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      { invalidate: () => invalidated++ },
    )
    for (const l of listeners) l({ file: 'MEMORY', source: 'user' })
    for (const l of listeners) l({ file: 'MEMORY', source: 'user' })
    expect(invalidated).toBe(2)
    off()
    expect(listeners.size).toBe(0)
  })
})

describe('host hooks', () => {
  it('dateHook appends the current date on UserPromptSubmit', async () => {
    const h = dateHook(() => new Date(2026, 8, 6))
    expect(h.events).toEqual(['UserPromptSubmit'])
    const r = await h.run('UserPromptSubmit', { threadId: 't' as never })
    expect(r?.additionalContext).toBe('当前日期：2026-09-06（周日）')
    expect(formatChineseDate(new Date(2026, 0, 1))).toBe('2026-01-01（周四）')
  })

  it('memoryToastHook toasts only for a successful remember', async () => {
    const toasts: ToastPayload[] = []
    const h = memoryToastHook((p) => toasts.push(p))
    await h.run('PostToolUse', { threadId: 't' as never, toolName: 'recall', output: {} })
    await h.run('PostToolUse', { threadId: 't' as never, toolName: 'remember', output: { isError: true } })
    expect(toasts).toEqual([])
    await h.run('PostToolUse', { threadId: 't' as never, toolName: 'remember', output: { content: 'ok' } })
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.kind).toBe('success')
    expect(toasts[0]?.action?.command).toBe('tab.openSettings')
  })
})
