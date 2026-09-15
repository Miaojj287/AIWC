import { describe, expect, it } from 'vitest'
import { parseRolloutLine, ThreadSettingsSchema } from './rolloutLine'

const meta = {
  ts: 1,
  type: 'thread_meta',
  threadId: 'thr_a',
  origin: { channel: 'desktop' },
  settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
}

describe('parseRolloutLine', () => {
  it('accepts every line the kernel writes and keeps fields a newer build added', () => {
    const item = {
      ts: 2,
      type: 'item',
      item: {
        type: 'assistant_message',
        id: 'itm_1',
        turnId: 'trn_1',
        stepId: 'stp_1',
        createdAt: 2,
        text: '好的',
        citationsChecked: true,
      },
    }
    const parsed = parseRolloutLine(JSON.stringify(item))
    expect(parsed).toEqual({ ok: true, line: item })
    expect(parseRolloutLine(JSON.stringify(meta)).ok).toBe(true)
    expect(
      parseRolloutLine(
        JSON.stringify({
          ts: 3,
          type: 'turn_context',
          turnId: 'trn_1',
          modelId: 'm',
          profile: 'cron',
          permissionMode: 'bypass',
        }),
      ).ok,
    ).toBe(true)
  })

  it("normalises the removed 'plan' permission mode to ask instead of rejecting the thread", () => {
    const parsed = parseRolloutLine(JSON.stringify({ ...meta, settings: { ...meta.settings, permissionMode: 'plan' } }))
    expect(parsed.ok && parsed.line.type === 'thread_meta' && parsed.line.settings.permissionMode).toBe('ask')
    expect(ThreadSettingsSchema.parse({ profile: 'wechat-bot', allowAlways: [] }).permissionMode).toBe('ask')
  })

  it('rejects a torn write as invalid_json', () => {
    expect(parseRolloutLine('{"ts":1,"type":"item","item":{"type":"user_mes')).toEqual({
      ok: false,
      rejection: { reason: 'invalid_json' },
    })
  })

  it('rejects wrong shapes with codes and paths only, never the values', () => {
    const secret = '聊天原文'
    const cases = [
      { ts: 1, type: 'item' },
      { ts: 1, type: 'item', item: { type: 'user_message', id: 'itm_1', text: secret } },
      { ...meta, threadId: '' },
      { ...meta, settings: { ...meta.settings, profile: secret } },
      { ts: 1, type: 'from_the_future', payload: secret },
      [secret],
    ]
    for (const value of cases) {
      const parsed = parseRolloutLine(JSON.stringify(value))
      expect(parsed.ok).toBe(false)
      if (parsed.ok) continue
      expect(parsed.rejection.reason).toBe('invalid_shape')
      expect(JSON.stringify(parsed.rejection)).not.toContain(secret)
    }
  })
})
