import { describe, expect, it } from 'vitest'
import type { ContextFragment, Event } from '@aiwc/protocol'
import { createFragment } from './context/fragments/base'
import { createMockModelClient } from './model/mock'
import { createThreadHarness, userInput } from './testing/harness'
import { waitForEvent, type FakeTool } from './testing/fakes'
import { deferred, sleep } from './util/deferred'

const readTool = (name: string, delayMs = 0, parallelSafe = true): FakeTool => ({
  name,
  parallelSafe,
  risk: 'read',
  async execute(input) {
    await sleep(delayMs)
    return { content: { tool: name, input } }
  },
})

describe('turn loop', () => {
  it('(1) plain text turn emits started/text/completed and persists items', async () => {
    const model = createMockModelClient([{ text: '你好，我在。' }])
    const h = await createThreadHarness({ model })
    const handle = await h.thread.startTurn(userInput('你在吗'), 'start')
    const result = await handle.promise
    expect(result.status).toBe('completed')
    const types = h.events.types()
    expect(types.filter((type) => type !== 'thread.title')[0]).toBe('turn.started')
    expect(types).toContain('item.user')
    expect(types).toContain('text.start')
    expect(types.filter((t) => t === 'text.delta').length).toBeGreaterThan(0)
    expect(types).toContain('text.end')
    expect(types[types.length - 1]).toBe('turn.completed')
    const completed = h.events.events.find((e) => e.type === 'turn.completed')
    expect(completed && completed.type === 'turn.completed' && completed.finalText).toBe('你好，我在。')

    const persisted = h.services.rollout.itemsOf(h.thread.id)
    expect(persisted.map((i) => i.type)).toEqual(expect.arrayContaining(['user_message', 'context_fragment', 'assistant_message']))
    const log = h.services.rollout.log
    expect(log.lastIndexOf('flush')).toBeGreaterThan(log.findIndex((l) => l.includes('assistant_message')))
    expect(h.services.hooks.calls.map((c) => c.event)).toEqual(expect.arrayContaining(['UserPromptSubmit', 'Stop']))
    expect(model.requests[0]!.system).toContain('你是 AIWC 的本地助手。')
    expect(model.requests[0]!.system).toContain('<volatile>')
  })

  it('(2) two-step tool loop records results in call order with shared/exclusive gating', async () => {
    const model = createMockModelClient([
      {
        toolCalls: [
          { name: 'slow_read', input: { q: 1 } },
          { name: 'fast_read', input: { q: 2 } },
          { name: 'writer', input: { q: 3 } },
        ],
      },
      { text: '完成。' },
    ])
    const completionOrder: string[] = []
    const tools: FakeTool[] = [
      { ...readTool('slow_read', 40), async execute(input) { await sleep(40); completionOrder.push('slow_read'); return { content: { input } } } },
      { ...readTool('fast_read', 0), async execute(input) { completionOrder.push('fast_read'); return { content: { input } } } },
      { ...readTool('writer', 0, false), risk: 'write', async execute(input) { completionOrder.push('writer'); return { content: { input } } } },
    ]
    const h = await createThreadHarness({ model, tools })
    const result = await (await h.thread.startTurn(userInput('查一下'), 'start')).promise
    expect(result.status).toBe('completed')
    expect(result.status === 'completed' && result.steps).toBe(2)
    // fast_read completed before slow_read (parallel), writer waited for both (exclusive)
    expect(completionOrder).toEqual(['fast_read', 'slow_read', 'writer'])
    const items = h.thread.context.all()
    const results = items.filter((i) => i.type === 'tool_result')
    expect(results.map((r) => r.toolName)).toEqual(['slow_read', 'fast_read', 'writer'])
    const calls = items.filter((i) => i.type === 'tool_call')
    expect(calls.map((c) => c.callId)).toEqual(results.map((r) => r.callId))
    // second request sees tool call + result pairs
    const second = model.requests[1]!
    expect(second.history.filter((i) => i.type === 'tool_result').length).toBe(3)
    expect(h.events.types().filter((t) => t === 'step.started').length).toBe(2)
  })

  it('(3) step cap aborts with step_cap', async () => {
    const model = createMockModelClient(Array.from({ length: 6 }, (_, i) => ({ toolCalls: [{ name: 'read', input: { i } }] })))
    const h = await createThreadHarness({ model, tools: [readTool('read')], config: { maxStepsPerTurn: 3 } })
    const result = await (await h.thread.startTurn(userInput('一直查'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'step_cap' })
    expect(model.requests.length).toBe(3)
    const aborted = h.events.events.find((e) => e.type === 'turn.aborted')
    expect(aborted).toMatchObject({ type: 'turn.aborted', reason: 'step_cap' })
    expect(h.thread.context.all().at(-1)).toMatchObject({ type: 'turn_aborted', reason: 'step_cap' })
  })

  it('(4a) loop guard trips on 3 identical calls and refuses the third batch BEFORE dispatch', async () => {
    const model = createMockModelClient({ steps: [{ toolCalls: [{ name: 'read', input: { same: true } }] }], loopLast: true })
    const h = await createThreadHarness({ model, tools: [readTool('read')] })
    const result = await (await h.thread.startTurn(userInput('循环'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'loop_guard' })
    expect(model.requests.length).toBe(3)
    // only the first two batches ever reached the router
    expect(h.services.tools.dispatchLog).toEqual(['read', 'read'])
    const results = h.thread.context.all().filter((i) => i.type === 'tool_result')
    expect(results).toHaveLength(3)
    expect(results[2]).toMatchObject({ isError: true, output: { type: 'text', text: 'loop guard' } })
    const refused = h.events.events.filter((e) => e.type === 'tool.call' && e.status === 'error')
    expect(refused).toHaveLength(1)
    expect(h.thread.context.all().at(-1)).toMatchObject({ type: 'turn_aborted', reason: 'loop_guard' })
    const types = h.events.types()
    expect(types[types.length - 1]).toBe('turn.aborted')
    expect(h.services.rollout.log.lastIndexOf('flush')).toBeGreaterThan(h.services.rollout.log.findIndex((l) => l.includes('turn_aborted')))
  })

  it('(5c) the turn timeout aborts with reason timeout', async () => {
    const model = createMockModelClient([{ text: '这是一段慢慢输出的很长很长的回复内容，永远写不完。', delayMs: 30, chunkSize: 1 }])
    const h = await createThreadHarness({ model, config: { turnTimeoutMs: 80 } })
    const result = await (await h.thread.startTurn(userInput('慢'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'timeout' })
    expect(h.events.events.find((e) => e.type === 'turn.aborted')).toMatchObject({ reason: 'timeout' })
    expect(h.thread.context.all().at(-1)).toMatchObject({ type: 'turn_aborted', reason: 'timeout' })
  })

  it('(6) an interrupt during in-flight compaction is an interruption, not compaction_failed', async () => {
    const model = createMockModelClient({
      steps: [{ text: '第一轮的回答。'.repeat(40) }, { toolCalls: [{ name: 'read', input: { q: 1 } }] }, { text: '完成' }],
      ref: { contextWindow: 100 },
    })
    const aux = createMockModelClient({ steps: [{ text: '摘要'.repeat(200), delayMs: 20, chunkSize: 1 }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux, tools: [readTool('read')], config: { compactionThreshold: 0.1 } })
    expect(await (await h.thread.startTurn(userInput('一'), 'start')).promise).toMatchObject({ status: 'completed' })
    const handle = await h.thread.startTurn(userInput('二'), 'start')
    const start = Date.now()
    while (!h.services.hooks.calls.some((c) => c.event === 'PreCompact')) {
      if (Date.now() - start > 3000) throw new Error('compaction never started')
      await sleep(5)
    }
    await sleep(30)
    handle.interrupt()
    const result = await handle.promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'interrupted' })
    const errors = h.events.events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(0)
    expect(h.thread.context.all().some((i) => i.type === 'compaction_summary')).toBe(false)
    expect(h.events.types()).not.toContain('context.compacted')
  })

  it('(4c) rollout durability: a failing flush yields rollout_write_failed and never turn.completed', async () => {
    const model = createMockModelClient([{ text: '写好了。' }])
    const h = await createThreadHarness({ model })
    h.services.rollout.flush = async () => {
      throw new Error('disk full')
    }
    const result = await (await h.thread.startTurn(userInput('记一下'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'error', text: '写好了。' })
    const types = h.events.types()
    expect(types).not.toContain('turn.completed')
    expect(types[types.length - 1]).toBe('turn.aborted')
    const err = h.events.events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.error.code).toBe('rollout_write_failed')
    expect(err && err.type === 'error' && err.error.message).toContain('disk full')
  })

  it('(4d) rollout durability: a failing append surfaces at the flush barrier', async () => {
    const model = createMockModelClient([{ text: '写好了。' }])
    const h = await createThreadHarness({ model })
    const original = h.services.rollout.append
    let failures = 0
    h.services.rollout.append = async (threadId, lines) => {
      if (lines.some((l) => l.type === 'item' && l.item.type === 'assistant_message')) {
        failures++
        throw new Error('EIO')
      }
      return original(threadId, lines)
    }
    const result = await (await h.thread.startTurn(userInput('记一下'), 'start')).promise
    expect(failures).toBe(1)
    expect(result).toMatchObject({ status: 'aborted', reason: 'error' })
    expect(h.events.types()).not.toContain('turn.completed')
    const codes = h.events.events.flatMap((e) => (e.type === 'error' ? [e.error.code] : []))
    expect(codes).toContain('rollout_write_failed')
    // the failure is reported once; the next turn (append healthy again) completes normally
    h.services.rollout.append = original
    const model2 = createMockModelClient([{ text: '好。' }])
    const svc = h.services.models as unknown as { resolve: () => Promise<unknown> }
    svc.resolve = async () => model2
    expect(await (await h.thread.startTurn(userInput('再来'), 'start')).promise).toMatchObject({ status: 'completed' })
  })

  it('(7b) usage breakdown reports memory / references separately and shares the system base with the prompt line', async () => {
    const model = createMockModelClient({ steps: [{ text: '好。' }], loopLast: true })
    const provider = {
      tier: 'turn' as const,
      provide: async (): Promise<ContextFragment[]> => [createFragment('relationship_profile', '<relationship_profile>', 2000, () => '张三：老同学，聊天风格随意。')],
    }
    const h = await createThreadHarness({ model, tools: [readTool('read')], fragmentProviders: [provider] })
    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    const usage = h.events.events.find((e) => e.type === 'context.usage')
    expect(usage && usage.type === 'context.usage' && usage.usage.breakdown.memory).toBeGreaterThan(0)
    expect(usage && usage.type === 'context.usage' && usage.usage.breakdown.references).toBeGreaterThan(0)
    expect(usage && usage.type === 'context.usage' && usage.usage.breakdown.system).toBeGreaterThan(0)
    // the prompt's 上下文占用 line was computed from the same system base: it never exceeds the post-step usage
    const line = /上下文占用：([\d,]+) \/ ([\d,]+)/.exec(model.requests[0]!.system)
    expect(line).not.toBeNull()
    const before = Number(line![1]!.replace(/,/g, ''))
    expect(before).toBeGreaterThan(0)
    expect(usage && usage.type === 'context.usage' && usage.usage.usedTokens).toBeGreaterThanOrEqual(before)
  })

  it('(11) image tool outputs are stored as a bounded placeholder, never raw base64', async () => {
    const data = 'QUJD'.repeat(400) // 1600 base64 chars → 1200 bytes
    const model = createMockModelClient([{ toolCalls: [{ name: 'shot', input: {} }] }, { text: '看到了。' }])
    const shot: FakeTool = { name: 'shot', parallelSafe: true, execute: async () => ({ content: { type: 'image', mediaType: 'image/png', data } }) }
    const h = await createThreadHarness({ model, tools: [shot] })
    expect(await (await h.thread.startTurn(userInput('截图'), 'start')).promise).toMatchObject({ status: 'completed' })
    const result = h.thread.context.all().find((i) => i.type === 'tool_result')
    expect(result && result.type === 'tool_result' && result.output).toEqual({ type: 'json', value: { type: 'image', mediaType: 'image/png', bytes: 1200 } })
    expect(JSON.stringify(h.thread.context.all())).not.toContain('QUJDQUJDQUJDQUJD')
    expect(JSON.stringify(h.services.rollout.itemsOf(h.thread.id))).not.toContain('QUJDQUJDQUJDQUJD')
    expect(JSON.stringify(model.requests[1]!.history)).not.toContain('QUJDQUJDQUJDQUJD')
  })

  it('(4b) loop guard trips on A-B-A-B alternation', async () => {
    const a = { name: 'read', input: { k: 'a' } }
    const b = { name: 'read', input: { k: 'b' } }
    const model = createMockModelClient([{ toolCalls: [a] }, { toolCalls: [b] }, { toolCalls: [a] }, { toolCalls: [b] }, { toolCalls: [a] }, { text: 'never' }])
    const h = await createThreadHarness({ model, tools: [readTool('read')] })
    const result = await (await h.thread.startTurn(userInput('交替'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'loop_guard' })
    expect(model.requests.length).toBe(4)
  })

  it('(5) interrupt mid-stream records turn_aborted and flushes before turn.aborted', async () => {
    const model = createMockModelClient([{ text: '这是一段会被打断的很长很长的回复内容，一直往下写。', delayMs: 15, chunkSize: 2 }])
    const h = await createThreadHarness({ model })
    let logAtAbortEvent: string[] = []
    let itemsAtAbortEvent: string[] = []
    h.emitter.on((e: Event) => {
      if (e.type === 'turn.aborted') {
        logAtAbortEvent = [...h.services.rollout.log]
        itemsAtAbortEvent = h.services.rollout.itemsOf(h.thread.id).map((i) => i.type)
      }
    })
    const handle = await h.thread.startTurn(userInput('说点什么'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    await h.thread.submit({ type: 'turn.interrupt', threadId: h.thread.id })
    const result = await handle.promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'interrupted' })
    expect(itemsAtAbortEvent).toContain('turn_aborted')
    const abortedIdx = logAtAbortEvent.findIndex((l) => l.includes('turn_aborted'))
    const flushIdx = logAtAbortEvent.lastIndexOf('flush')
    expect(abortedIdx).toBeGreaterThanOrEqual(0)
    expect(flushIdx).toBeGreaterThan(abortedIdx)
    expect(h.events.types().filter((t) => t === 'turn.completed')).toHaveLength(0)
    // partial assistant text is kept
    expect(h.thread.context.all().some((i) => i.type === 'assistant_message' && i.text.length > 0)).toBe(true)
    expect(h.services.hooks.calls.map((c) => c.event)).toContain('TurnAborted')
  })

  it('(5b) interrupt during a long tool call marks it interrupted after the grace period', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'hang', input: {} }] }, { text: 'unused' }])
    const hang: FakeTool = { name: 'hang', parallelSafe: true, execute: () => new Promise(() => undefined) }
    const h = await createThreadHarness({ model, tools: [hang] })
    const handle = await h.thread.startTurn(userInput('挂住'), 'start')
    await waitForEvent(h.emitter.on, 'tool.call')
    await sleep(10)
    handle.interrupt()
    const result = await handle.promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'interrupted' })
    const results = h.thread.context.all().filter((i) => i.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0]!.isError).toBe(true)
    expect(h.thread.context.all().at(-1)?.type).toBe('turn_aborted')
  })

  it('(9) steer merges into the running turn', async () => {
    const model = createMockModelClient([{ text: '第一步回答，比较长以便可以被并入。', delayMs: 10, chunkSize: 2 }, { text: '第二步补充。' }])
    const h = await createThreadHarness({ model })
    const handle = await h.thread.startTurn(userInput('第一句'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    await h.thread.submit({ type: 'turn.start', threadId: h.thread.id, input: userInput('补充一句'), mode: 'steer' })
    const result = await handle.promise
    expect(result.status).toBe('completed')
    expect(result.status === 'completed' && result.steps).toBe(2)
    expect(h.events.types().filter((t) => t === 'turn.started')).toHaveLength(1)
    expect(h.events.types().filter((t) => t === 'turn.completed')).toHaveLength(1)
    const userItems = h.thread.context.all().filter((i) => i.type === 'user_message')
    expect(userItems).toHaveLength(2)
    expect(userItems.every((u) => u.turnId === handle.turnId)).toBe(true)
    expect(model.requests[1]!.history.filter((i) => i.type === 'user_message')).toHaveLength(2)
  })

  it('(9b) a steer that arrives after the step loop ended starts a new turn instead of being dropped', async () => {
    const model = createMockModelClient([{ text: '一' }, { text: '二' }])
    const aux = createMockModelClient({ steps: [{ text: '标题' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    const stopStarted = deferred<void>()
    h.services.hooks.add({
      name: 'slow-stop',
      events: ['Stop'],
      async run() {
        stopStarted.resolve()
        await sleep(50)
      },
    })
    const first = await h.thread.startTurn(userInput('第一句'), 'start')
    await stopStarted.promise
    // the loop is over (Stop hook running): steer() must refuse and the Thread must fall through to a new turn
    expect(first.steer(userInput('太晚了'))).toBe(false)
    const second = await h.thread.startTurn(userInput('补充一句'), 'steer')
    expect(second.turnId).not.toBe(first.turnId)
    expect(await first.promise).toMatchObject({ status: 'completed', text: '一' })
    expect(await second.promise).toMatchObject({ status: 'completed', text: '二' })
    const users = h.thread.context.all().filter((i) => i.type === 'user_message')
    expect(users.map((u) => (u.content[0]!.type === 'text' ? u.content[0]!.text : ''))).toEqual(['第一句', '补充一句'])
    expect(h.events.types().filter((t) => t === 'turn.started')).toHaveLength(2)
    expect(h.events.types().filter((t) => t === 'turn.completed')).toHaveLength(2)
    expect(h.thread.activeTurn).toBeUndefined()
  })

  it('(10b) user_instructions are recorded once per distinct text, never duplicated into world_state', async () => {
    const model = createMockModelClient({ steps: [{ text: '好。' }], loopLast: true })
    let rules = '回复要简短。'
    const provider = {
      tier: 'turn' as const,
      provide: async (): Promise<ContextFragment[]> => [createFragment('user_instructions', '<user_instructions>', 2000, () => rules)],
    }
    const h = await createThreadHarness({ model, tools: [readTool('read')], fragmentProviders: [provider] })
    const fragments = (kind: string) => h.thread.context.all().filter((i) => i.type === 'context_fragment' && i.kind === kind)

    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    expect(fragments('user_instructions')).toHaveLength(1)
    expect(fragments('world_state')).toHaveLength(1)
    expect(fragments('world_state')[0]!.text).not.toContain('回复要简短')
    expect(fragments('world_state')[0]!.text).not.toContain('用户规则')

    await (await h.thread.startTurn(userInput('二'), 'start')).promise
    expect(fragments('user_instructions')).toHaveLength(1)
    expect(fragments('world_state')).toHaveLength(1)

    rules = '回复要详细。'
    await (await h.thread.startTurn(userInput('三'), 'start')).promise
    expect(fragments('user_instructions')).toHaveLength(2)
    expect(fragments('user_instructions')[1]!.text).toContain('回复要详细')
    expect(fragments('world_state')).toHaveLength(1)

    // the rollout keeps a digest, not the rules text
    const snapshots = h.services.rollout.linesOf(h.thread.id).filter((l) => l.type === 'world_state')
    expect(snapshots.length).toBeGreaterThan(0)
    for (const line of snapshots) {
      if (line.type !== 'world_state') continue
      expect(String(line.snapshot.userInstructions)).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('(10) world-state fragment is injected once and again only when permission mode changes', async () => {
    const model = createMockModelClient({ steps: [{ text: '好。' }], loopLast: true })
    const h = await createThreadHarness({ model, tools: [readTool('read')] })
    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    const worldFragments = () => h.thread.context.all().filter((i) => i.type === 'context_fragment' && i.kind === 'world_state')
    expect(worldFragments()).toHaveLength(1)
    expect(worldFragments()[0]!.text).toContain('read')
    await (await h.thread.startTurn(userInput('二'), 'start')).promise
    expect(worldFragments()).toHaveLength(1)
    h.thread.updateSettings({ permissionMode: 'ask' })
    await (await h.thread.startTurn(userInput('三'), 'start')).promise
    expect(worldFragments()).toHaveLength(2)
    expect(worldFragments()[1]!.text).toContain('权限模式')
    expect(worldFragments()[1]!.text).not.toContain('可用工具')
  })

  it('replaces a running turn when a new turn.start arrives without steer', async () => {
    const model = createMockModelClient([{ text: '第一轮很长很长的内容会被替换掉。', delayMs: 10, chunkSize: 2 }, { text: '第二轮。' }])
    const h = await createThreadHarness({ model })
    const first = await h.thread.startTurn(userInput('一'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    await h.thread.submit({ type: 'turn.start', threadId: h.thread.id, input: userInput('二') })
    expect(await first.promise).toMatchObject({ status: 'aborted', reason: 'replaced' })
    await h.thread.activeTurn?.promise
    expect(h.events.types().filter((t) => t === 'turn.completed')).toHaveLength(1)
  })

  it('emits an error event with actions and aborts when the model fails', async () => {
    const model = createMockModelClient([{ error: { code: 'auth', message: 'bad key', status: 401, retryable: false } }])
    const h = await createThreadHarness({ model })
    const result = await (await h.thread.startTurn(userInput('x'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'error' })
    const err = h.events.events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.actions.map((a) => a.action)).toContain('open_settings_ai')
  })

  it('runs the auxiliary model to generate a title after the first completed turn', async () => {
    const model = createMockModelClient([{ text: '好的。' }])
    const aux = createMockModelClient({ steps: [{ text: '“打招呼测试”' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    await (await h.thread.startTurn(userInput('你好'), 'start')).promise
    const title = await waitForEvent(h.emitter.on, 'thread.title')
    expect(title.title).toBe('打招呼测试')
    expect(h.thread.settings.title).toBe('打招呼测试')
    expect(h.services.rollout.log).toContain('updateMeta')
  })
})
