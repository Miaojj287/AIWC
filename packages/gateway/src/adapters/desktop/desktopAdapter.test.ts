import { describe, expect, it } from 'vitest'
import { createDesktopAdapter } from './desktopAdapter'

describe('desktop adapter', () => {
  it('injects events to onMessage subscribers and resolves sends', async () => {
    const adapter = createDesktopAdapter({ now: () => 42 })
    const got: string[] = []
    adapter.onMessage((e) => {
      got.push(e.text)
    })
    const states: string[] = []
    adapter.onStateChange((s) => {
      states.push(s)
    })

    await adapter.connect()
    const ev = adapter.injectText('你好', { chatId: 'thr_1' })
    expect(ev.source).toMatchObject({ channel: 'desktop', peerId: 'me', chatId: 'thr_1', chatType: 'dm' })
    expect(ev.addressed).toBe(true)
    expect(got).toEqual(['你好'])

    const res = await adapter.send({ to: ev.source, parts: [{ type: 'text', text: 'hi' }], reason: 'agent_tool' })
    expect(res.ok).toBe(true)
    expect(adapter.sent).toHaveLength(1)
    await adapter.disconnect()
    expect(states).toEqual(['connected', 'disconnected'])
    expect(adapter.state).toBe('disconnected')
  })
})
