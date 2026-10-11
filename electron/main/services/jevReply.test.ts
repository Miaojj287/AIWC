import { describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule, JevResponse, MessageEvent, SubstrateService, WxMessage } from '@aiwc/protocol'
import {
  buildJevQuestions,
  buildJevState,
  candidateOptions,
  createJevReplyDecider,
  interpretJevAnswers,
  previewJevReply,
} from './jevReply'

const rule = (over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: 'r',
  sessionId: 'alice',
  enabled: true,
  source: 'jev',
  historyCount: 20,
  sendMode: 'auto',
  updatedAt: 0,
  jev: { candidates: ['好的收到', '{昵称}我晚点回你'], allowSilence: true, minConfidence: 0.6 },
  ...over,
})

const event: MessageEvent = {
  id: 'owner:alice:9:9',
  source: { channel: 'wechat-ui', chatId: 'alice', peerId: 'alice', chatType: 'dm', displayName: 'Alice' },
  kind: 'text',
  text: '报价能再发一份吗',
  timestamp: 1_700_000_000_000,
  addressed: true,
  raw: { localMessageId: '9', senderName: 'Alice' },
}

const wx = (id: string, text: string, isSelf = false, extra: Partial<WxMessage> = {}): WxMessage => ({
  id,
  seq: Number(id),
  sessionId: 'alice',
  createdAt: 1_700_000_000_000 - (10 - Number(id)) * 60_000,
  senderId: isSelf ? 'owner' : 'alice',
  senderName: isSelf ? undefined : 'Alice',
  isSelf,
  kind: 'text',
  text,
  anchor: { sessionId: 'alice', messageId: id, seq: Number(id), createdAt: 0 },
  ...extra,
})

const choice = (choice: string, probabilities: Record<string, number>, confidence: number): JevResponse => ({
  model: 'jev-1.13.0',
  answers: {
    reply: { type: 'choice', choice, probabilities, confidence },
    needs_reply: { type: 'noul', noul: 0.8 },
  },
  usage: { input_tokens: 321, output_tokens: 12 },
})

describe('buildJevState', () => {
  it('structures the chat, drops the incoming message from the history and stays inside the budget', () => {
    const history = [wx('7', '上次的报价单', true), wx('8', '收到，谢谢'), wx('9', '报价能再发一份吗')]
    const { state, chars } = buildJevState({ event, history, now: 1_700_000_000_000 })
    expect(state.chat).toEqual({ name: 'Alice', type: 'direct' })
    expect(state.incoming).toMatchObject({ from: 'Alice', text: '报价能再发一份吗' })
    const lines = state.recent_messages as Array<{ from: string; text: string }>
    expect(lines.map((l) => l.text)).toEqual(['上次的报价单', '收到，谢谢'])
    expect(lines[0]?.from).toBe('me')
    expect(state.minutes_since_my_last_message).toBe(3)
    expect(chars).toBe(JSON.stringify(state).length)

    const huge = Array.from({ length: 200 }, (_, i) => wx(String(i + 100), 'x'.repeat(900)))
    const bounded = buildJevState({ event, history: huge, now: 0 })
    expect((bounded.state.recent_messages as unknown[]).length).toBeLessThan(20)
  })
})

describe('buildJevQuestions / candidateOptions', () => {
  it('offers the candidates (variables filled) plus none, and carries the user guidance', () => {
    const options = candidateOptions(['好的收到', '{昵称}我晚点回你', '  '], {
      nickname: '小王',
      time: '10:00',
      groupName: '',
    })
    expect(options).toEqual({ c1: '好的收到', c2: '小王我晚点回你' })
    const questions = buildJevQuestions({ allowSilence: true, instructions: '问价格就选第一条' }, options)
    const reply = questions.reply
    expect(reply?.type).toBe('choice')
    if (reply?.type !== 'choice') throw new Error('expected a choice')
    expect(Object.keys(reply.criteria)).toEqual(['c1', 'c2', 'none'])
    expect((reply.instructions as Record<string, unknown>).my_rules).toBe('问价格就选第一条')
    expect(questions.needs_reply?.type).toBe('noul')
    const strict = buildJevQuestions({ allowSilence: false }, options).reply
    if (strict?.type !== 'choice') throw new Error('expected a choice')
    expect(Object.keys(strict.criteria)).toEqual(['c1', 'c2'])
    expect((strict.instructions as Record<string, unknown>).my_rules).toBeUndefined()
  })
})

describe('interpretJevAnswers', () => {
  const options = { c1: '好的收到', c2: '我晚点回你' }
  it('sends a confident candidate, parks an unsure one, and stays silent on a confident none', () => {
    const config = { minConfidence: 0.6 }
    const send = interpretJevAnswers({
      response: choice('c1', { c1: 0.8, c2: 0.1, none: 0.1 }, 0.75),
      options,
      config,
      latencyMs: 90,
    })
    expect(send.decision).toMatchObject({
      outcome: 'send',
      choice: 'c1',
      confidence: 0.75,
      threshold: 0.6,
      needsReply: 0.8,
      inputTokens: 321,
      latencyMs: 90,
    })
    expect(send.text).toBe('好的收到')

    const unsure = interpretJevAnswers({
      response: choice('c2', { c1: 0.4, c2: 0.45, none: 0.15 }, 0.3),
      options,
      config,
      latencyMs: 90,
    })
    expect(unsure.decision.outcome).toBe('confirm')
    expect(unsure.text).toBe('我晚点回你')

    const silent = interpretJevAnswers({
      response: choice('none', { c1: 0.05, c2: 0.05, none: 0.9 }, 0.9),
      options,
      config,
      latencyMs: 90,
    })
    expect(silent.decision.outcome).toBe('silence')
    expect(silent.text).toBeUndefined()
  })

  it('an unsure none parks the best candidate instead of dropping the message', () => {
    const result = interpretJevAnswers({
      response: choice('none', { c1: 0.42, c2: 0.1, none: 0.48 }, 0.2),
      options,
      config: { minConfidence: 0.6 },
      latencyMs: 1,
    })
    expect(result.decision.outcome).toBe('confirm')
    expect(result.text).toBe('好的收到')
  })

  it('refuses answers without the choice', () => {
    expect(() =>
      interpretJevAnswers({
        response: { model: 'm', answers: { needs_reply: { type: 'noul', noul: 0.5 } } },
        options,
        config: { minConfidence: 0.6 },
        latencyMs: 1,
      }),
    ).toThrow()
  })
})

function harness(response: JevResponse, over: { last?: WxMessage } = {}) {
  const ask = vi.fn(async () => response)
  const messages = [wx('8', '收到，谢谢', true), over.last ?? wx('9', '报价能再发一份吗')]
  const substrate = {
    listMessages: vi.fn(async (q: { limit: number }) => ({ items: messages.slice(-q.limit), hasMore: false })),
    getSession: vi.fn(async () => ({ id: 'alice', title: 'Alice', kind: 'dm' })),
    status: () => ({ connection: 'ready', account: { wxid: 'owner', nickname: '我' }, sync: { phase: 'idle' } }),
  } as unknown as SubstrateService
  const deps = {
    substrate,
    jev: { ask },
    resolveNames: async () => ({ nickname: '小王' }),
    now: () => 1_700_000_000_000,
  }
  return { ask, substrate, deps }
}

describe('createJevReplyDecider.generate', () => {
  it('returns the reply, a confirm flag when unsure, or a skip with a reason', async () => {
    const send = harness(choice('c2', { c1: 0.1, c2: 0.85, none: 0.05 }, 0.8))
    const decider = createJevReplyDecider(send.deps)
    expect(await decider.generate(event, rule())).toEqual({
      text: '小王我晚点回你',
      jev: expect.objectContaining({ outcome: 'send', options: { c1: '好的收到', c2: '小王我晚点回你' } }),
    })
    // The rule's own history depth bounds the read; the state carries the transcript, not the questions.
    expect(send.substrate.listMessages).toHaveBeenCalledWith({ sessionId: 'alice', limit: 20 })
    const [state, questions] = send.ask.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(state.incoming).toMatchObject({ text: '报价能再发一份吗' })
    expect(Object.keys(questions)).toEqual(['reply', 'needs_reply'])

    const unsure = createJevReplyDecider(harness(choice('c1', { c1: 0.5, c2: 0.3, none: 0.2 }, 0.35)).deps)
    expect(await unsure.generate(event, rule())).toMatchObject({ text: '好的收到', confirm: true })

    const silent = createJevReplyDecider(harness(choice('none', { c1: 0.05, c2: 0.05, none: 0.9 }, 0.92)).deps)
    const skipped = await silent.generate(event, rule())
    expect(skipped).toMatchObject({
      skip: expect.stringContaining('92%'),
      jev: expect.objectContaining({ outcome: 'silence' }),
    })
  })

  it('fails loudly without candidates instead of asking Jev', async () => {
    const h = harness(choice('c1', { c1: 1 }, 1))
    const decider = createJevReplyDecider(h.deps)
    await expect(
      decider.generate(event, rule({ jev: { candidates: [], allowSilence: true, minConfidence: 0.6 } })),
    ).rejects.toThrow(/候选/)
    expect(h.ask).not.toHaveBeenCalled()
  })
})

describe('previewJevReply', () => {
  it('runs the draft against the last peer message and reports the trigger with the decision', async () => {
    const h = harness(choice('c1', { c1: 0.7, c2: 0.2, none: 0.1 }, 0.65))
    const preview = await previewJevReply(h.deps, 'alice', rule())
    expect(preview.trigger).toMatchObject({ text: '报价能再发一份吗', senderName: 'Alice' })
    expect(preview.decision.outcome).toBe('send')
    expect(preview.text).toBe('好的收到')
    expect(preview.stateChars).toBeGreaterThan(0)
  })

  it('explains when there is nothing to answer', async () => {
    const h = harness(choice('c1', { c1: 1 }, 1), { last: wx('9', '我发的', true) })
    await expect(previewJevReply(h.deps, 'alice', rule())).rejects.toThrow(/你发的/)
    expect(h.ask).not.toHaveBeenCalled()
  })
})
