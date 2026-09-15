import { describe, expect, it, vi } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { planFocus } from './focusPlan'

const message = (id: string, seq: number): WxMessage => ({
  id,
  sessionId: 's',
  seq,
  createdAt: seq * 1000,
  senderId: 'p',
  isSelf: false,
  kind: 'text',
  text: 'x',
  anchor: { sessionId: 's', messageId: id, seq, createdAt: seq * 1000 },
})

describe('planFocus', () => {
  it('scrolls to a message that is already loaded without asking the substrate', async () => {
    const fetch = vi.fn()
    const plan = await planFocus('m1', {
      loaded: (id) => (id === 'm1' ? message('m1', 5) : undefined),
      fetch,
      filtered: () => false,
    })
    expect(plan).toEqual({ kind: 'focus', id: 'm1' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('jumps with the real anchor (never a guessed seq) when the message is not loaded', async () => {
    const plan = await planFocus('wx:26442:900', {
      loaded: () => undefined,
      fetch: async () => message('wx:26442:900', 900),
      filtered: () => false,
    })
    expect(plan).toEqual({
      kind: 'jump',
      anchor: { sessionId: 's', messageId: 'wx:26442:900', seq: 900, createdAt: 900_000 },
    })
  })

  it('clears the tab filters first when they are active', async () => {
    const plan = await planFocus('m2', {
      loaded: () => undefined,
      fetch: async () => message('m2', 7),
      filtered: () => true,
    })
    expect(plan.kind).toBe('jump-unfiltered')
  })

  it('reports a message the index does not have, including a failed lookup', async () => {
    expect(
      await planFocus('nope', { loaded: () => undefined, fetch: async () => undefined, filtered: () => false }),
    ).toEqual({ kind: 'missing' })
    expect(
      await planFocus('boom', {
        loaded: () => undefined,
        fetch: async () => {
          throw new Error('offline')
        },
        filtered: () => false,
      }),
    ).toEqual({ kind: 'missing' })
  })

  it('focuses instead of reloading when the page containing it arrived during the lookup', async () => {
    let loaded = false
    const plan = await planFocus('m3', {
      loaded: (id) => (loaded && id === 'm3' ? message('m3', 3) : undefined),
      fetch: async () => {
        loaded = true
        return message('m3', 3)
      },
      filtered: () => true,
    })
    expect(plan).toEqual({ kind: 'focus', id: 'm3' })
  })
})
