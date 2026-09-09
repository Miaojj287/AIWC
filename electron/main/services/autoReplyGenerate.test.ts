import { describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule, MessageEvent, ModelClient, SamplingRequest, SubstrateService } from '@aiwc/protocol'
import { createAutoReplyGenerator } from './autoReplyGenerate'

const rule: AutoReplyRule = { id: 'r', sessionId: 'alice', enabled: true, source: 'ai', historyCount: 30, updatedAt: 0 }
const event: MessageEvent = { id: 'm', source: { channel: 'wechat-ui', chatId: 'alice', peerId: 'alice', chatType: 'dm' }, kind: 'text', text: '明天见', timestamp: 10, addressed: true }

function setup(output = '好呀，明天见') {
  const requests: SamplingRequest[] = []
  const model = { ref: { supportsVision: false }, async *sample(req: SamplingRequest) { requests.push(req); yield { type: 'text.delta' as const, delta: output } } } as ModelClient
  const listMessages = vi.fn(async () => ({ items: [{ seq: 1, isSelf: true, text: '好滴' }, { seq: 2, isSelf: false, kind: 'voice', text: '[语音]', media: { transcript: '明天下午聊' } }] }))
  const generate = createAutoReplyGenerator({ model: async () => model, substrate: { listMessages } as unknown as SubstrateService })
  return { generate, requests, listMessages }
}

describe('auto-reply generation', () => {
  it("uses the rule's own prompt and history depth, with voice transcripts, and never offers tools", async () => {
    const h = setup()
    const result = await h.generate(event, { ...rule, prompt: '不要约具体时间', historyCount: 120 })
    expect(result).toEqual({ text: '好呀，明天见' })
    expect(h.listMessages).toHaveBeenCalledWith({ sessionId: 'alice', limit: 120 })
    const req = h.requests[0]!
    expect(req.system).toContain('不要约具体时间')
    // The guard-rails stay in front of the user prompt; they are not a setting.
    expect(req.system).toContain('不编造金额')
    expect(JSON.stringify(req.history)).toContain('明天下午聊')
    expect(req.tools).toEqual([])
    expect(req.toolChoice).toBe('none')
  })

  it('works with no prompt at all', async () => {
    const h = setup()
    await expect(h.generate(event, rule)).resolves.toEqual({ text: '好呀，明天见' })
    expect(h.requests[0]!.system).not.toContain('主人给你的设定')
  })

  it('unwraps a fenced reply instead of sending the backticks to a contact', async () => {
    const h = setup('```\n明天见\n```')
    await expect(h.generate(event, rule)).resolves.toEqual({ text: '明天见' })
  })

  it('refuses an empty reply rather than sending a blank message', async () => {
    const h = setup('   ')
    await expect(h.generate(event, rule)).rejects.toThrow('没有生成可用回复')
  })

  it('drops a generation cancelled while context was loading', async () => {
    const h = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(h.generate(event, rule, controller.signal)).rejects.toThrow('已取消')
  })
})
