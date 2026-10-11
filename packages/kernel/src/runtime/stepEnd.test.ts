import { describe, expect, it } from 'vitest'
import type { FinishReason, ModelClient, SamplingPart, SamplingRequest } from '@aiwc/protocol'
import { judgeStepEnd, MAX_LENGTH_CONTINUATIONS } from './stepEnd'
import { createThreadHarness, userInput } from './testing/harness'

/** One sampling request per entry: text (possibly empty) with the given finish reason, or a retryable failure. */
type Reply = { text: string; finish: FinishReason } | { fail: 'network' }

function replies(list: Reply[]): ModelClient & { requests: SamplingRequest[] } {
  const requests: SamplingRequest[] = []
  return {
    requests,
    ref: {
      providerId: 'p',
      modelId: 'm',
      label: 'M',
      contextWindow: 32_000,
      supportsTools: true,
      supportsVision: false,
      local: true,
    },
    async *sample(req): AsyncIterable<SamplingPart> {
      const reply = list[requests.length] ?? { text: '', finish: 'stop' }
      requests.push(req)
      if ('fail' in reply) {
        yield { type: 'error', error: { code: 'network', message: 'reset', retryable: true } }
        return
      }
      if (reply.text) yield { type: 'text.delta', delta: reply.text }
      yield { type: 'finish', reason: reply.finish, usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
}

const noWait = { sleep: async () => {}, random: () => 0.5 }

describe('judgeStepEnd', () => {
  it('continues a cut-off answer a bounded number of times and refuses filtered or empty answers', () => {
    expect(judgeStepEnd({ text: 'a', toolCalls: [], finish: 'length' }, 0, '')).toEqual({ kind: 'continue' })
    expect(judgeStepEnd({ text: 'a', toolCalls: [], finish: 'length' }, MAX_LENGTH_CONTINUATIONS, '')).toMatchObject({
      kind: 'fail',
      error: { code: 'output_truncated' },
    })
    expect(judgeStepEnd({ text: '', toolCalls: [], finish: 'content_filter' }, 0, '')).toMatchObject({
      error: { code: 'content_filter' },
    })
    expect(judgeStepEnd({ text: ' ', toolCalls: [], finish: 'stop' }, 0, '')).toMatchObject({
      error: { code: 'empty_response' },
    })
    expect(judgeStepEnd({ text: '', toolCalls: [], finish: 'stop' }, 0, 'earlier answer')).toEqual({ kind: 'ok' })
    expect(judgeStepEnd({ text: '', toolCalls: [{}], finish: 'length' }, 0, '')).toEqual({ kind: 'ok' })
  })
})

describe('turn endings', () => {
  it('continues an answer cut off by the output limit and joins the parts', async () => {
    const model = replies([
      { text: '第一段', finish: 'length' },
      { text: '第二段', finish: 'stop' },
    ])
    const h = await createThreadHarness({ model })
    const result = await (await h.thread.startTurn(userInput('写长文'), 'start')).promise
    expect(result).toMatchObject({ status: 'completed', text: '第一段第二段' })
    expect(h.events.events).toContainEqual(expect.objectContaining({ type: 'turn.continuing', attempt: 1, max: 2 }))
    const fragment = model.requests[1]!.history.find((i) => i.type === 'context_fragment' && i.kind === 'continuation')
    expect(fragment).toBeDefined()
  })

  it('ends with an error card when the answer keeps getting cut off, is filtered, or is empty', async () => {
    const cut = await createThreadHarness({
      model: replies([
        { text: 'a', finish: 'length' },
        { text: 'b', finish: 'length' },
        { text: 'c', finish: 'length' },
      ]),
    })
    expect((await (await cut.thread.startTurn(userInput('x'), 'start')).promise).status).toBe('aborted')
    expect(cut.events.events).toContainEqual(
      expect.objectContaining({ type: 'error', error: expect.objectContaining({ code: 'output_truncated' }) }),
    )

    for (const [reply, code] of [
      [{ text: '', finish: 'content_filter' }, 'content_filter'],
      [{ text: '', finish: 'stop' }, 'empty_response'],
    ] as const) {
      const h = await createThreadHarness({ model: replies([reply]) })
      const result = await (await h.thread.startTurn(userInput('x'), 'start')).promise
      expect(result).toMatchObject({ status: 'aborted', reason: 'error' })
      const error = h.events.events.find((e) => e.type === 'error')
      expect(error).toMatchObject({ error: { code } })
      expect(error && error.type === 'error' && error.actions.map((a) => a.action)).toContain('retry')
    }
  })

  it('does not pass a cut-off answer at the step cap for a finished one', async () => {
    expect(judgeStepEnd({ text: 'a', toolCalls: [], finish: 'length' }, 0, '', false)).toMatchObject({
      kind: 'fail',
      error: { code: 'output_truncated' },
    })
    const h = await createThreadHarness({
      model: replies([{ text: '半截', finish: 'length' }]),
      config: { maxStepsPerTurn: 1 },
    })
    const result = await (await h.thread.startTurn(userInput('x'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'error' })
    expect(h.events.events).toContainEqual(
      expect.objectContaining({ type: 'error', error: expect.objectContaining({ code: 'output_truncated' }) }),
    )
    expect(h.events.events.some((e) => e.type === 'turn.completed')).toBe(false)
  })

  it('announces request retries on the running turn', async () => {
    const model = replies([{ fail: 'network' }, { text: '好了', finish: 'stop' }])
    const h = await createThreadHarness({ model, config: { stream: noWait } })
    const result = await (await h.thread.startTurn(userInput('x'), 'start')).promise
    expect(result).toMatchObject({ status: 'completed', text: '好了' })
    expect(h.events.events).toContainEqual(
      expect.objectContaining({ type: 'stream.retrying', attempt: 1, max: 3, reason: 'network' }),
    )
  })
})
