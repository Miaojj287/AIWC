import { describe, expect, it } from 'vitest'
import { runWorkflow, validatePlan, workflowView, WorkflowStepFailure, type WorkflowPlan } from './workflowEngine'

const step = (id: string, dependsOn: string[] = [], mode: 'read' | 'write' = 'read') => ({
  id,
  title: id.toUpperCase(),
  prompt: `do ${id}`,
  dependsOn,
  mode,
  output: 'text' as const,
})

const plan = (steps: WorkflowPlan['steps'], maxConcurrency = 3): WorkflowPlan => ({ title: 'T', steps, maxConcurrency })

describe('validatePlan', () => {
  it('accepts a DAG and rejects duplicates, unknown or self dependencies and cycles', () => {
    expect(validatePlan(plan([step('a'), step('b', ['a'])]))).toBeUndefined()
    expect(validatePlan(plan([step('a'), step('a')]))).toMatch(/重复/)
    expect(validatePlan(plan([step('a', ['x'])]))).toMatch(/不存在/)
    expect(validatePlan(plan([step('a', ['a'])]))).toMatch(/自己/)
    expect(validatePlan(plan([step('a', ['b']), step('b', ['a'])]))).toMatch(/循环/)
  })
})

describe('runWorkflow', () => {
  it('runs dependencies first, hands their outputs on and respects the concurrency cap', async () => {
    let live = 0
    let peak = 0
    const order: string[] = []
    const seen: Record<string, string[]> = {}
    const states = await runWorkflow(plan([step('a'), step('b'), step('c'), step('d', ['a', 'b', 'c'])], 2), {
      stepTimeoutMs: 10_000,
      signal: new AbortController().signal,
      async runStep(s, inputs) {
        live++
        peak = Math.max(peak, live)
        await Promise.resolve()
        order.push(s.id)
        seen[s.id] = inputs.map((i) => i.output)
        live--
        return `out-${s.id}`
      },
    })
    expect(peak).toBe(2)
    expect(order.at(-1)).toBe('d')
    expect(seen.d).toEqual(['out-a', 'out-b', 'out-c'])
    expect([...states.values()].every((s) => s.status === 'done')).toBe(true)
  })

  it('skips the dependents of a failed step (transitively) and keeps independent steps going', async () => {
    const states = await runWorkflow(plan([step('a'), step('b', ['a']), step('c', ['b']), step('d')]), {
      stepTimeoutMs: 10_000,
      signal: new AbortController().signal,
      async runStep(s) {
        if (s.id === 'a') throw new WorkflowStepFailure('invalid_json', 'bad')
        return 'ok'
      },
    })
    expect(states.get('a')).toMatchObject({ status: 'failed', error: 'invalid_json' })
    expect(states.get('b')).toMatchObject({ status: 'skipped', error: 'dependency_failed' })
    expect(states.get('c')).toMatchObject({ status: 'skipped' })
    expect(states.get('d')).toMatchObject({ status: 'done' })
    const view = workflowView(plan([step('a'), step('b', ['a']), step('c', ['b']), step('d')]), states, {
      done: true,
      outputChars: 100,
    })
    expect(view.status).toBe('partial')
    expect(view.steps[0]!.output).toBe('bad')
  })

  it('times a step out on its own limit', async () => {
    const states = await runWorkflow(plan([step('a')]), {
      stepTimeoutMs: 5,
      signal: new AbortController().signal,
      runStep: (_s, _i, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    })
    expect(states.get('a')).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('cancels running and pending steps when the call is interrupted', async () => {
    const controller = new AbortController()
    const updates: string[] = []
    const states = await runWorkflow(plan([step('a'), step('b', ['a'])]), {
      stepTimeoutMs: 10_000,
      signal: controller.signal,
      onUpdate: (s) => updates.push(s.get('a')!.status),
      runStep: (_s, _i, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
          controller.abort()
        }),
    })
    expect(states.get('a')!.status).toBe('cancelled')
    expect(states.get('b')!.status).toBe('cancelled')
    expect(updates[0]).toBe('running')
    expect(workflowView(plan([step('a'), step('b', ['a'])]), states, { done: true }).status).toBe('cancelled')
  })
})
