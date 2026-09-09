import { describe, expect, it, vi } from 'vitest'
import { asThreadId } from '@aiwc/protocol'
import type { Hook } from '../ports'
import { createHookRunner } from './hooks'

const payload = { threadId: asThreadId('thr_1'), toolName: 't', input: { a: 1 } }

describe('createHookRunner', () => {
  it('merges results in order: first block wins, context concatenated, input/output last wins', async () => {
    const runner = createHookRunner()
    runner.add({ name: 'a', events: ['PreToolUse'], run: async () => ({ additionalContext: 'A', updatedInput: { a: 2 } }) })
    runner.add({
      name: 'b',
      events: ['PreToolUse'],
      run: async (_e, p) => ({ block: { reason: `saw ${(p.input as { a: number }).a}` }, additionalContext: 'B', updatedInput: { a: 3 } }),
    })
    runner.add({ name: 'c', events: ['PreToolUse'], run: async () => ({ block: { reason: 'late' } }) })
    runner.add({ name: 'other-event', events: ['Stop'], run: async () => ({ block: { reason: 'nope' } }) })
    const r = await runner.run('PreToolUse', payload)
    expect(r.block?.reason).toBe('saw 2') // second hook sees the first hook's rewrite
    expect(r.additionalContext).toBe('A\nB')
    expect(r.updatedInput).toEqual({ a: 3 })
  })

  it('swallows and logs hook exceptions', async () => {
    const logger = vi.fn()
    const runner = createHookRunner({ logger })
    runner.add({ name: 'boom', events: ['PostToolUse'], run: async () => { throw new Error('x') } })
    runner.add({ name: 'ok', events: ['PostToolUse'], run: async () => ({ updatedOutput: 'replaced' }) })
    const r = await runner.run('PostToolUse', { ...payload, output: 'orig' })
    expect(r.updatedOutput).toBe('replaced')
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('boom'), expect.any(Error))
  })

  it('add() returns a remover; empty runner returns {}', async () => {
    const runner = createHookRunner()
    const hook: Hook = { name: 'h', events: ['Stop'], run: async () => ({ additionalContext: 'x' }) }
    const remove = runner.add(hook)
    remove()
    expect(await runner.run('Stop', payload)).toEqual({})
  })
})
