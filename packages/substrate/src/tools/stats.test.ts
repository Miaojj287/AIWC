import { describe, expect, it } from 'vitest'
import { chatStats } from './chatStats'
import { body, runTool } from './testing/ctx'
import { T0, sampleWorld } from './testing/fakeSubstrate'

describe('chat_stats', () => {
  it('overview forwards the query and returns rows', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(chatStats, { metric: 'overview', sessionId: 'user_a' }, sub))
    expect(sub.calls[0]).toEqual({ method: 'stats', args: [{ metric: 'overview', sessionId: 'user_a' }] })
    expect(out.metric).toBe('overview')
    expect(out.scope).toEqual({ sessionId: 'user_a' })
    expect(out.rows[0]).toMatchObject({ total: 6, sent: 2, received: 4, text: 3, voice: 1, image: 1, file: 1 })
    expect(out.total).toBe(6)
  })
  it('ranking passes limit and is global without sessionId', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(chatStats, { metric: 'ranking', limit: 1 }, sub))
    expect(sub.calls[0]).toEqual({ method: 'stats', args: [{ metric: 'ranking', limit: 1 }] })
    expect(out.scope).toBe('global')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ id: 'user_a', messageCount: 6 })
  })
  it('time_distribution defaults groupBy to hour and passes the range', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(chatStats, { metric: 'time_distribution', from: T0, to: T0 + 3_600_000 }, sub))
    expect(sub.calls[0]).toEqual({ method: 'stats', args: [{ metric: 'time_distribution', from: T0, to: T0 + 3_600_000, groupBy: 'hour' }] })
    expect(out.groupBy).toBe('hour')
    expect(out.rows.length).toBeGreaterThan(0)
    expect(out.range.from).toMatch(/^\d{4}-/)

    await runTool(chatStats, { metric: 'time_distribution', groupBy: 'weekday' }, sub)
    expect(sub.calls[1]?.args[0]).toMatchObject({ groupBy: 'weekday' })
  })
  it('notes empty results', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(chatStats, { metric: 'ranking', sessionId: 'ghost' }, sub))
    expect(out.rows).toEqual([])
    expect(out.note).toBeDefined()
  })
  it('validates metric, groupBy, limit and from<=to', () => {
    const s = chatStats.inputSchema
    expect(s.safeParse({}).success).toBe(false)
    expect(s.safeParse({ metric: 'count' }).success).toBe(false)
    expect(s.safeParse({ metric: 'time_distribution', groupBy: 'year' }).success).toBe(false)
    expect(s.safeParse({ metric: 'ranking', limit: 101 }).success).toBe(false)
    expect(s.safeParse({ metric: 'overview', from: 2, to: 1 }).success).toBe(false)
    expect(s.safeParse({ metric: 'overview' }).success).toBe(true)
  })
})
