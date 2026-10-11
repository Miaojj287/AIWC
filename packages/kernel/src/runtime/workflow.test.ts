import { describe, expect, it } from 'vitest'
import { asCallId, asTurnId, newStepId, parseWorkflowView, type ThreadId, type ToolContext } from '@aiwc/protocol'
import { createKernel } from './kernel'
import { createMockModelClient } from './model/mock'
import { createTestServices } from './testing/fakes'
import { defaultTestConfig } from './testing/harness'
import { buildStepPrompt, createWorkflowTool, parseStepJson, WorkflowInputSchema } from './workflow'

const ctx = (threadId: ThreadId, patch: Partial<ToolContext> = {}): ToolContext => ({
  threadId,
  turnId: asTurnId('trn_parent'),
  stepId: newStepId(),
  callId: asCallId('cal_wf'),
  channel: 'desktop',
  profile: 'desktop-chat',
  signal: new AbortController().signal,
  services: {},
  progress: () => undefined,
  depth: 0,
  ...patch,
})

function setup(text = '结论：完成。') {
  const model = createMockModelClient({ steps: [{ text }], loopLast: true })
  const services = createTestServices({ model })
  const aliases: Array<[string, string]> = []
  services.approvals.alias = (child, parent) => {
    aliases.push([child, parent])
    return () => undefined
  }
  const k = createKernel({ services, config: () => defaultTestConfig(), systemPrompt: { stable: '你是 AIWC。' } })
  return { k, model, services, aliases, tool: createWorkflowTool(() => k) }
}

describe('workflow_run', () => {
  it('runs read steps as subagents and write steps with the parent profile, passing results along', async () => {
    const { k, model, services, aliases, tool } = setup()
    const parent = await k.ensureThread({ channel: 'desktop' }, { permissionMode: 'ask' })
    const progress: unknown[] = []
    const subagentEvents: Array<{ status: string; step?: string; callId?: string }> = []
    k.events.on((e) => {
      if (e.type === 'subagent') subagentEvents.push({ status: e.status, step: e.step, callId: e.callId })
    })
    const input = WorkflowInputSchema.parse({
      title: '整理周报',
      steps: [
        { id: 'collect', title: '收集', prompt: '查本周消息' },
        { id: 'write', title: '写入', prompt: '写成文件', dependsOn: ['collect'], mode: 'write' },
      ],
    })
    const result = await tool.execute(input, ctx(parent, { progress: (_m, _f, d) => progress.push(d) }))
    expect(result.isError).toBeFalsy()
    const view = parseWorkflowView(result.content)
    expect(view?.status).toBe('done')
    expect(view?.steps.map((s) => s.status)).toEqual(['done', 'done'])
    expect(view?.steps[0]!.output).toContain('完成')
    const profiles = services.tools.builds.filter((b) => b.depth === 1).map((b) => b.profile)
    expect(profiles).toContain('subagent')
    expect(profiles).toContain('desktop-chat')
    expect(services.tools.builds.filter((b) => b.depth === 1).every((b) => b.permissionMode === 'ask')).toBe(true)
    // the write step's prompt carries the collect step's result
    const writeReq = model.requests.find((r) =>
      r.history.some((i) => i.type === 'user_message' && JSON.stringify(i.content).includes('前置步骤「收集」')),
    )
    expect(writeReq).toBeDefined()
    expect(aliases.every(([, p]) => p === parent)).toBe(true)
    expect(aliases).toHaveLength(2)
    // each step's sub-agent is announced under the workflow's own row, so the panel can show its work
    expect(subagentEvents).toEqual([
      { status: 'started', step: 'collect', callId: 'cal_wf' },
      { status: 'done', step: 'collect', callId: 'cal_wf' },
      { status: 'started', step: 'write', callId: 'cal_wf' },
      { status: 'done', step: 'write', callId: 'cal_wf' },
    ])
    // and its trace is kept with the result for history
    expect(result.subagents?.map((s) => [s.step, s.status])).toEqual([
      ['collect', 'done'],
      ['write', 'done'],
    ])
    expect(result.subagents?.[0]?.items.some((i) => i.type === 'assistant_message')).toBe(true)
    expect(progress.map((d) => parseWorkflowView(d)?.status)).toContain('running')
    expect((await k.listThreads()).map((t) => t.threadId)).toEqual([parent])
  })

  it('refuses invalid plans and nested use', async () => {
    const { k, tool } = setup()
    const parent = await k.ensureThread({ channel: 'desktop' })
    const cyclic = WorkflowInputSchema.parse({
      title: 'x',
      steps: [
        { id: 'a', title: 'A', prompt: 'p', dependsOn: ['b'] },
        { id: 'b', title: 'B', prompt: 'p', dependsOn: ['a'] },
      ],
    })
    expect((await tool.execute(cyclic, ctx(parent))).isError).toBe(true)
    const one = WorkflowInputSchema.parse({ title: 'x', steps: [{ id: 'a', title: 'A', prompt: 'p' }] })
    expect((await tool.execute(one, ctx(parent, { depth: 1 }))).isError).toBe(true)
  })

  it('a json step fails when the answer is not JSON and its dependents are skipped', async () => {
    const { k, tool } = setup('不是 JSON')
    const parent = await k.ensureThread({ channel: 'desktop' })
    const input = WorkflowInputSchema.parse({
      title: 'x',
      steps: [
        { id: 'a', title: 'A', prompt: 'p', output: 'json' },
        { id: 'b', title: 'B', prompt: 'p', dependsOn: ['a'] },
      ],
    })
    const view = parseWorkflowView((await tool.execute(input, ctx(parent))).content)
    expect(view?.steps.map((s) => [s.status, s.error])).toEqual([
      ['failed', 'invalid_json'],
      ['skipped', 'dependency_failed'],
    ])
    expect(view?.status).toBe('failed')
  })
})

describe('step helpers', () => {
  it('parses fenced or bare JSON and checks required keys', () => {
    expect(parseStepJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(parseStepJson('结果如下 {"a":1} 完')).toBe('{"a":1}')
    expect(() => parseStepJson('{"a":1}', { required: ['b'] })).toThrow(/b/)
    expect(() => parseStepJson('nope')).toThrow()
  })

  it('tells a json step to answer in JSON and a read step that it is read-only', () => {
    const base = { id: 'a', title: 'A', prompt: 'p', dependsOn: [], mode: 'read' as const, output: 'json' as const }
    const prompt = buildStepPrompt(base, [])
    expect(prompt).toContain('只读')
    expect(prompt).toContain('JSON')
  })
})
