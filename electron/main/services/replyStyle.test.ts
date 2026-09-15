import { describe, expect, it } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { EMPTY_STYLE, extractOwnerStyle, polishReply, renderStyleGuide } from './replyStyle'

let seq = 0
const msg = (text: string, isSelf: boolean, at: number, kind: WxMessage['kind'] = 'text'): WxMessage => {
  const id = String(++seq)
  return {
    id,
    sessionId: 's',
    seq,
    createdAt: at,
    senderId: isSelf ? 'me' : 'peer',
    isSelf,
    kind,
    text,
    anchor: { sessionId: 's', messageId: id, seq, createdAt: at },
  }
}

describe('extractOwnerStyle', () => {
  it("measures only the owner's text messages and keeps short verbatim samples, oldest first", () => {
    const t0 = 1_700_000_000_000
    const style = extractOwnerStyle([
      msg('你到了吗？', false, t0),
      msg('快了', true, t0 + 1000),
      msg('五分钟', true, t0 + 2000),
      msg('[图片]', true, t0 + 3000, 'image'),
      msg('https://example.com/x', true, t0 + 4000),
      msg('好的好的。', false, t0 + 5000),
      msg('快了', true, t0 + 600_000),
    ])
    expect(style.measured).toBe(4)
    // Deduped on the newest occurrence, then listed oldest first.
    expect(style.samples).toEqual(['五分钟', '快了'])
    expect(style.terminalPunctRatio).toBe(0)
    expect(style.emojiRatio).toBe(0)
    expect(style.usesNin).toBe(false)
    // 快了 → 五分钟 and 五分钟 → [图片] within 90s are bursts; the link and the later 快了 stand alone.
    expect(style.burstRatio).toBeCloseTo(2 / 4)
  })

  it('returns the empty style when the owner never wrote in this chat', () => {
    expect(extractOwnerStyle([msg('hi', false, 1)])).toEqual(EMPTY_STYLE)
    expect(renderStyleGuide(EMPTY_STYLE)).toBe('')
  })

  it('describes the habits it measured and lists the samples', () => {
    const t0 = 1_700_000_000_000
    const style = extractOwnerStyle([
      msg('好呀😂', true, t0),
      msg('明天见！', true, t0 + 1),
      msg('嗯嗯', true, t0 + 200_000),
    ])
    const guide = renderStyleGuide(style)
    expect(guide).toContain('## 主人在这个会话里的口吻')
    expect(guide).toContain('- 好呀😂')
    expect(guide).toContain('- 明天见！')
    expect(guide).toContain('从不用「您」')
    expect(guide).toContain('---wx-next---')
  })
})

describe('polishReply', () => {
  it('strips wrapping quotes, reply prefixes and Markdown the model added', () => {
    expect(polishReply('“回复：**好呀**，明天见”')).toBe('好呀，明天见')
    expect(polishReply('- 第一句\n- 第二句')).toBe('第一句\n第二句')
    expect(polishReply('「嗯嗯」')).toBe('嗯嗯')
  })

  it('drops the trailing full stop only when the owner never types one', () => {
    const terse = { ...EMPTY_STYLE, measured: 10, terminalPunctRatio: 0.05 }
    const formal = { ...EMPTY_STYLE, measured: 10, terminalPunctRatio: 0.8 }
    expect(polishReply('好的，我看下。', terse)).toBe('好的，我看下')
    expect(polishReply('好的，我看下。', formal)).toBe('好的，我看下。')
    expect(polishReply('真的吗？', terse)).toBe('真的吗？')
    // No measurement → leave the text alone.
    expect(polishReply('好的。')).toBe('好的。')
  })

  it('normalises the bubble marker onto its own line and polishes each bubble', () => {
    const terse = { ...EMPTY_STYLE, measured: 10, terminalPunctRatio: 0 }
    expect(polishReply('“快了。” ---wx-next--- “五分钟。”', terse)).toBe('快了\n---wx-next---\n五分钟')
    expect(polishReply('---wx-next---\n只有一条', terse)).toBe('只有一条')
  })
})
