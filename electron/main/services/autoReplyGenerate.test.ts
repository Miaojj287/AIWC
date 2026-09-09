import { describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule, MessageEvent, ModelClient, SamplingRequest, SamplingPart, SubstrateService } from '@aiwc/protocol'
import { createAutoReplyGenerator } from './autoReplyGenerate'

const rule: AutoReplyRule = { id: 'r', sessionId: 'alice', enabled: true, source: 'ai', historyCount: 30, updatedAt: 0 }
const event: MessageEvent = { id: 'm', source: { channel: 'wechat-ui', chatId: 'alice', peerId: 'alice', chatType: 'dm' }, kind: 'text', text: '明天见', timestamp: 10, addressed: true }

function setup(output = '好呀，明天见') {
  const requests: SamplingRequest[] = []
  const model = { ref: { supportsVision: false }, async *sample(req: SamplingRequest) { requests.push(req); yield { type: 'text.delta' as const, delta: output }; yield { type: 'finish' as const, reason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 10 } } } } as ModelClient
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

function scriptedGeneration(runs: SamplingPart[][], maxOutputTokens?: number) {
  const requests: SamplingRequest[] = []
  const logger = vi.fn()
  const model = {
    ref: { modelId: 'thinking-test', supportsVision: false, maxOutputTokens },
    async *sample(req: SamplingRequest) {
      requests.push(req)
      yield* runs[requests.length - 1]!
    },
  } as ModelClient
  return { requests, logger, generate: createAutoReplyGenerator({
    model: async () => model,
    substrate: { listMessages: async () => ({ items: [] }) } as unknown as SubstrateService,
    logger,
  }) }
}
const done = (reason: 'stop' | 'length' | 'content_filter' | 'aborted' | 'error'): SamplingPart =>
  ({ type: 'finish', reason, usage: { inputTokens: 100, outputTokens: 8192, reasoningTokens: 8192 } })

describe('thinking model output and finish handling', () => {
  it('retries reasoning-only exhaustion with more room and returns only the fresh complete draft', async () => {
    const h = scriptedGeneration([
      [{ type: 'reasoning.delta', delta: 'private reasoning' }, done('length')],
      [{ type: 'text.delta', delta: '明天见' }, done('stop')],
    ])
    await expect(h.generate(event, rule)).resolves.toEqual({ text: '明天见' })
    expect(h.requests.map(r => r.maxOutputTokens)).toEqual([8192, 16384])
    expect(JSON.stringify(h.logger.mock.calls)).not.toContain('private reasoning')
    expect(h.logger.mock.calls[0]![2]).toMatchObject({ finishReason: 'length', textChars: 0 })
  })

  it('discards a truncated draft instead of concatenating it with the retry', async () => {
    const h = scriptedGeneration([
      [{ type: 'text.delta', delta: 'unfinished' }, done('length')],
      [{ type: 'text.delta', delta: '完整回复' }, done('stop')],
    ])
    await expect(h.generate(event, rule)).resolves.toEqual({ text: '完整回复' })
    expect(JSON.stringify(h.requests[1]!.history)).not.toContain('unfinished')
  })

  it('stops after one retry and never returns either truncated draft', async () => {
    const h = scriptedGeneration([[done('length')], [{ type: 'text.delta', delta: 'partial' }, done('length')]])
    await expect(h.generate(event, rule)).rejects.toThrow('输出上限')
    expect(h.requests).toHaveLength(2)
  })

  it('respects an explicitly configured lower output cap without a futile retry', async () => {
    const h = scriptedGeneration([[done('length')]], 1024)
    await expect(h.generate(event, rule)).rejects.toThrow('输出上限')
    expect(h.requests.map(r => r.maxOutputTokens)).toEqual([1024])
  })

  it.each([
    ['content_filter', '拦截'], ['aborted', '取消'], ['error', '服务商'],
  ] as const)('reports %s distinctly without retrying', async (reason, message) => {
    const h = scriptedGeneration([[{ type: 'text.delta', delta: 'partial' }, done(reason)]])
    await expect(h.generate(event, rule)).rejects.toThrow(message)
    expect(h.requests).toHaveLength(1)
  })

  it('rejects a stream ending without a finish event even if it has text', async () => {
    const h = scriptedGeneration([[{ type: 'text.delta', delta: 'partial' }]])
    await expect(h.generate(event, rule)).rejects.toThrow('未确认')
  })
})
