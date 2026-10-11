import { describe, expect, it, vi } from 'vitest'
import { asThreadId, formatCitation, type WxMessage } from '@aiwc/protocol'
import { citationAuditHook } from './hooks'

const message = (id: string, text: string): WxMessage => ({
  id,
  sessionId: 'wxid_xw',
  seq: 1,
  createdAt: 1,
  senderId: 'wxid_xw',
  isSelf: false,
  kind: 'text',
  text,
  anchor: { sessionId: 'wxid_xw', messageId: id, seq: 1, createdAt: 1 },
})
const cite = (id: string) => formatCitation({ sessionId: 'wxid_xw', messageId: id }, '02-14 19:28')
const desktop = { channel: 'desktop' as const }

function setup(store: Record<string, WxMessage | Error>, around: Record<string, WxMessage[]> = {}) {
  const getMessage = vi.fn(async (_s: string, id: string) => {
    const hit = store[id]
    if (hit instanceof Error) throw hit
    return hit
  })
  const getContext = vi.fn(async (anchor: WxMessage['anchor']) => around[anchor.messageId] ?? [])
  return { getMessage, getContext, hook: citationAuditHook({ substrate: { getMessage, getContext } }) }
}

const run = (hook: ReturnType<typeof citationAuditHook>, text: string, extra: Record<string, unknown> = {}) =>
  hook.run('Stop', { threadId: asThreadId('thr_1'), text, origin: desktop, profile: 'desktop-chat', ...extra })

describe('citationAuditHook', () => {
  it('passes an answer whose quotes are in the cited messages', async () => {
    const h = setup({ 'wx:1:1': message('wx:1:1', '你自己都说没有 yanda 你会和小吴纠缠一阵子') })
    const result = await run(h.hook, `她说“你会和小吴纠缠一阵子” ${cite('wx:1:1')}`)
    expect(result?.block).toBeUndefined()
    // the passing audit is still reported for the transcript's system row
    expect(result?.checks).toEqual([{ kind: 'citations', checked: 1, failed: 0, issues: [], action: 'none' }])
  })

  it('blocks with the original text when a quote is not in its message, and when a cited message does not exist', async () => {
    const h = setup({ 'wx:26442:9': message('wx:26442:9', '她的反应是不能和 yanda or 全世界任何人说') })
    const result = await run(h.hook, `> “你和小吴已经在一起了” ${cite('wx:26442:9')}\n\n另一处 ${cite('wx:404:1')}`)
    expect(result?.block?.reason).toContain('「你和小吴已经在一起了」不在')
    expect(result?.block?.reason).toContain('原文是：「她的反应是不能和 yanda or 全世界任何人说」')
    expect(result?.block?.reason).toContain('wx://wxid_xw/wx:404:1')
    expect(result?.block?.reason).toContain('不存在')
    expect(result?.block?.reason).toMatch(/有 2 处对不上/)
    expect(result?.checks).toEqual([
      {
        kind: 'citations',
        checked: 2,
        failed: 2,
        issues: [
          {
            code: 'quote_mismatch',
            link: cite('wx:26442:9'),
            quote: '你和小吴已经在一起了',
            excerpt: '她的反应是不能和 yanda or 全世界任何人说',
          },
          { code: 'missing_message', link: cite('wx:404:1') },
        ],
        action: 'none',
      },
    ])
  })

  it('accepts quotes paired with the wrong link of the same run, and quotes from an adjacent message', async () => {
    const h = setup(
      {
        a: message('a', '还以为老陈这么抠搜了'),
        b: message('b', '喝太多导致睡不着'),
        x: message('x', '只是小陈另有其人'),
      },
      { x: [message('w', '不是的'), message('x', '只是小陈另有其人')] },
    )
    const answer = [
      `你接话：「喝太多导致睡不着」「还以为老陈这么抠搜了」 ${cite('a')} ${cite('b')}`,
      '',
      `小蜜否认：「不是的」「只是小陈另有其人」 ${cite('x')}`,
    ].join('\n')
    expect((await run(h.hook, answer))?.block).toBeUndefined()
  })

  it('still blocks a quote that is in neither the cited message nor its neighbours', async () => {
    const h = setup({ x: message('x', '只是小陈另有其人') }, { x: [message('w', '不是的')] })
    const result = await run(h.hook, `小蜜说「我就是老陈」 ${cite('x')}`)
    expect(result?.block?.reason).toContain('「我就是老陈」不在')
  })

  it('looks each message up once, and flags nothing when lookups fail (cannot verify ≠ wrong)', async () => {
    const h = setup({ 'wx:1:1': new Error('尚未连接微信数据') })
    const result = await run(h.hook, `“假的” ${cite('wx:1:1')} 和 “也是假的” ${cite('wx:1:1')}`)
    expect(result?.block).toBeUndefined()
    expect(result?.checks?.[0]).toMatchObject({ checked: 2, failed: 0 })
    expect(h.getMessage).toHaveBeenCalledTimes(1)
  })

  it('stays out of bot, cron and persona threads, and answers without citations', async () => {
    const h = setup({})
    const bad = `“编造” ${cite('wx:404:1')}`
    expect(
      await run(h.hook, bad, { origin: { channel: 'wechat-ui', chatId: 'x' }, profile: 'wechat-bot' }),
    ).toBeUndefined()
    expect(await run(h.hook, bad, { profile: 'persona' })).toBeUndefined()
    expect(await run(h.hook, '没有任何引用的回答')).toBeUndefined()
    expect(h.getMessage).not.toHaveBeenCalled()
  })
})
