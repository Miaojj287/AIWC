import { describe, expect, it, vi } from 'vitest'
import { asTurnId, newItemId, type ModelEntry, type SamplingPart } from '@aiwc/protocol'
import { createAiSdkModelClient } from './aiSdk'

/** An OpenAI-compatible chat-completions stream that writes one tool call's arguments in pieces. */
function toolCallStream(): Response {
  const chunk = (delta: unknown, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const body = [
    chunk({
      role: 'assistant',
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'find', arguments: '' } }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"周报"}' } }] }),
    chunk({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ].join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('AI SDK adapter — tool arguments as they stream', () => {
  it('yields tool_input.delta parts named after the tool, then the whole call', async () => {
    const model: ModelEntry = {
      modelId: 'm',
      label: 'm',
      enabled: true,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 32_000,
    }
    const client = createAiSdkModelClient({
      provider: {
        id: 'compat',
        label: 'compat',
        kind: 'openai-compatible',
        baseUrl: 'https://example.invalid/v1',
        models: [model],
      },
      model,
      apiKey: 'test-only-key',
      fetch: vi.fn<typeof fetch>(async () => toolCallStream()),
    })
    const parts: SamplingPart[] = []
    for await (const part of client.sample({
      system: 's',
      history: [
        {
          type: 'user_message',
          id: newItemId(),
          turnId: asTurnId('t'),
          createdAt: 1,
          content: [{ type: 'text', text: '找' }],
          mentions: [],
        },
      ],
      tools: [
        {
          name: 'find',
          description: 'find',
          inputJsonSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      toolChoice: 'auto',
      signal: new AbortController().signal,
    }))
      parts.push(part)
    const deltas = parts.filter((p) => p.type === 'tool_input.delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((p) => p.type === 'tool_input.delta' && p.name === 'find' && p.callId === 'call_1')).toBe(true)
    expect(deltas.map((p) => (p.type === 'tool_input.delta' ? p.delta : '')).join('')).toBe('{"query":"周报"}')
    const call = parts.find((p) => p.type === 'tool_call')
    expect(call).toMatchObject({ type: 'tool_call', callId: 'call_1', name: 'find', input: { query: '周报' } })
    expect(parts.indexOf(call!)).toBeGreaterThan(parts.indexOf(deltas.at(-1)!))
  })
})
