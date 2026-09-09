// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { newThreadId, type ApprovalId, type Event, type EventChannel, type EventMap, type ThreadId } from '@aiwc/protocol'
import { createMockBridge, demoFixture, type MockBridge } from './mockBridge'

const NOW = Date.UTC(2026, 8, 6, 4, 0, 0)

function waitFor<K extends EventChannel>(bridge: MockBridge, channel: K, predicate: (p: EventMap[K]) => boolean, timeoutMs = 4000): Promise<EventMap[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timed out waiting for ${channel}`))
    }, timeoutMs)
    const off = bridge.on(channel, (payload) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      off()
      resolve(payload)
    })
  })
}

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }

async function createThread(bridge: MockBridge): Promise<ThreadId> {
  const threadId = newThreadId()
  await bridge.invoke('agent:submit', { type: 'thread.create', threadId, origin: { channel: 'desktop' }, settings })
  return threadId
}

async function runTurn(bridge: MockBridge, threadId: ThreadId, text: string): Promise<Event[]> {
  const events: Event[] = []
  const off = bridge.on('agent:event', (e) => {
    if (e.threadId === threadId) events.push(e)
  })
  const done = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && (e.type === 'turn.completed' || e.type === 'turn.aborted'))
  await bridge.invoke('agent:submit', { type: 'turn.start', threadId, input: { content: [{ type: 'text', text }], mentions: [] } })
  await done
  off()
  return events
}

describe('mock bridge', () => {
  let bridge: MockBridge
  beforeEach(() => {
    localStorage.clear()
    bridge = createMockBridge({ timeScale: 0, now: () => NOW, seed: 7, onboarding: false })
  })

  it('reports web runtime and serves every invoke channel', async () => {
    expect(bridge.runtime).toBe('web')
    const info = await bridge.invoke('app:getInfo', undefined)
    expect(info.isPackaged).toBe(false)
    const status = await bridge.invoke('substrate:status', undefined)
    expect(status.connection).toBe('ready')
    expect(status.account?.wxid).toBe(demoFixture.account.wxid)
    // Same wording and same allow-list as the preload, so the web preview cannot accept a channel
    // the packaged app would reject.
    await expect(bridge.invoke('bogus:channel' as never, undefined as never)).rejects.toThrow(/unknown ipc channel/)
  })

  it('pages sessions with filters', async () => {
    const page1 = await bridge.invoke('substrate:listSessions', { limit: 10 })
    expect(page1.items).toHaveLength(10)
    expect(page1.total).toBe(40)
    expect(page1.hasMore).toBe(true)
    expect(page1.items[0]?.pinned).toBe(true)
    const last = await bridge.invoke('substrate:listSessions', { limit: 10, offset: 35 })
    expect(last.items).toHaveLength(5)
    expect(last.hasMore).toBe(false)
    const dm = await bridge.invoke('substrate:listSessions', { limit: 100, kind: 'dm' })
    expect(dm.total).toBe(26)
    expect(dm.items.every((s) => s.kind === 'dm')).toBe(true)
    const unread = await bridge.invoke('substrate:listSessions', { limit: 100, unreadOnly: true })
    expect(unread.items.every((s) => s.unread > 0)).toBe(true)
    const byName = await bridge.invoke('substrate:listSessions', { limit: 100, query: dm.items[0]!.title.slice(0, 2) })
    expect(byName.total).toBeGreaterThan(0)
  })

  it('rebases timestamps to now and pages messages both ways', async () => {
    const { items } = await bridge.invoke('substrate:listSessions', { limit: 1 })
    const sessionId = items[0]!.id
    const latest = await bridge.invoke('substrate:listMessages', { sessionId, limit: 20 })
    expect(latest.items.length).toBe(20)
    expect(latest.hasMore).toBe(true)
    for (let i = 1; i < latest.items.length; i++) expect(latest.items[i]!.seq).toBeGreaterThan(latest.items[i - 1]!.seq)
    const newest = latest.items.at(-1)!
    expect(newest.createdAt).toBeLessThan(NOW)
    expect(newest.createdAt).toBeGreaterThan(NOW - 24 * 3_600_000)
    const older = await bridge.invoke('substrate:listMessages', { sessionId, limit: 20, beforeSeq: latest.items[0]!.seq })
    expect(older.items.every((m) => m.seq < latest.items[0]!.seq)).toBe(true)
    const ctx = await bridge.invoke('substrate:getContext', { anchor: newest.anchor, radius: 3 })
    expect(ctx.some((m) => m.id === newest.id)).toBe(true)
    expect(ctx.length).toBeLessThanOrEqual(7)
  })

  it('searches by substring with highlighted snippets and computes stats', async () => {
    const hits = await bridge.invoke('substrate:search', { query: '收到', limit: 10 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(10)
    expect(hits[0]!.snippet).toContain('<b>收到</b>')
    expect(hits[0]!.source).toBe('fts')
    const overview = await bridge.invoke('substrate:stats', { metric: 'overview' })
    expect(overview.total).toBe(demoFixture.messages.filter((m) => m.kind !== 'system').length)
    const ranking = await bridge.invoke('substrate:stats', { metric: 'ranking', limit: 3 })
    expect(ranking.rows.length).toBe(3)
    const byHour = await bridge.invoke('substrate:stats', { metric: 'time_distribution', groupBy: 'hour' })
    expect(byHour.rows).toHaveLength(24)
  })

  it('resolves media to data URLs and transcribes voice', async () => {
    const voice = demoFixture.messages.find((m) => m.kind === 'voice' && m.media?.transcript)!
    const media = await bridge.invoke('substrate:resolveMedia', { sessionId: voice.sessionId, messageId: voice.id })
    expect(media?.path?.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(await bridge.invoke('substrate:transcribeVoice', { sessionId: voice.sessionId, messageId: voice.id })).toBe(voice.media!.transcript)
    const silent = demoFixture.messages.find((m) => m.kind === 'voice' && !m.media?.transcript)!
    const text = await bridge.invoke('substrate:transcribeVoice', { sessionId: silent.sessionId, messageId: silent.id })
    expect(text.length).toBeGreaterThan(0)
    const image = demoFixture.messages.find((m) => m.kind === 'image')!
    const img = await bridge.invoke('substrate:resolveMedia', { sessionId: image.sessionId, messageId: image.id })
    expect(img?.path?.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('persists config in localStorage and honours the onboarding flag', async () => {
    const cfg = await bridge.invoke('config:get', undefined)
    expect(cfg.onboarding.completed).toBe(true)
    const next = await bridge.invoke('config:set', { general: { theme: 'light' } })
    expect(next.general.theme).toBe('light')
    expect(next.agent.permissionMode).toBe('ask')
    expect(JSON.parse(localStorage.getItem('aiwc.mock.config') ?? '{}').general.theme).toBe('light')
    const onboarding = createMockBridge({ timeScale: 0, now: () => NOW, onboarding: true })
    expect((await onboarding.invoke('config:get', undefined)).onboarding.completed).toBe(false)
  })

  it('agent:submit runs a scripted turn ending in turn.completed', async () => {
    const threadId = await createThread(bridge)
    const events = await runTurn(bridge, threadId, '帮我找一下关于评审的消息')
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('item.user')
    expect(types).toContain('turn.started')
    expect(types).toContain('text.delta')
    expect(types).toContain('context.usage')
    expect(types.at(-2)).toBe('turn.completed')
    expect(types.at(-1)).toBe('thread.title')
    const toolCalls = events.filter((e) => e.type === 'tool.call')
    expect(toolCalls.map((e) => e.status)).toEqual(['pending', 'running', 'done'])
    expect(toolCalls[0]!.toolName).toBe('search_messages')
    expect(toolCalls[2]!.output).toBeDefined()
    const completed = events.find((e) => e.type === 'turn.completed')!
    expect(completed.finalText).toContain('评审')
    const { items, summary } = await bridge.invoke('agent:getThread', { threadId })
    expect(items.map((i) => i.type)).toEqual(['user_message', 'assistant_message', 'tool_call', 'tool_result', 'assistant_message'])
    expect(summary.title).toBe('帮我找一下关于评审的消息')
    expect(await bridge.invoke('agent:listThreads', {})).toHaveLength(1)
  })

  it('asks before sending on every 3rd turn and continues after approval.resolve', async () => {
    const threadId = await createThread(bridge)
    await runTurn(bridge, threadId, '第一轮')
    await runTurn(bridge, threadId, '第二轮')
    const approval = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'approval.requested')
    const completed = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'turn.completed')
    const sendDone = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'tool.call' && e.toolName === 'send_message' && e.status === 'done')
    await bridge.invoke('agent:submit', { type: 'turn.start', threadId, input: { content: [{ type: 'text', text: '第三轮' }], mentions: [] } })
    const req = (await approval) as Extract<Event, { type: 'approval.requested' }>
    expect(req.toolName).toBe('send_message')
    expect(req.risk).toBe('send')
    await bridge.invoke('agent:submit', { type: 'approval.resolve', threadId, approvalId: req.approvalId as ApprovalId, decision: 'allow_once' })
    await sendDone
    await completed
  })

  it('never asks for a read, still asks before sending in bypass, and denies cleanly', async () => {
    const threadId = await createThread(bridge)
    await bridge.invoke('agent:submit', { type: 'thread.settings', threadId, patch: { permissionMode: 'bypass' } })
    for (const text of ['一', '二']) {
      const events = await runTurn(bridge, threadId, text)
      expect(events.some((e) => e.type === 'tool.call')).toBe(true)
      expect(events.some((e) => e.type === 'approval.requested')).toBe(false)
    }
    const approval = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'approval.requested')
    const denied = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'tool.call' && e.status === 'denied')
    const completed = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'turn.completed')
    await bridge.invoke('agent:submit', { type: 'turn.start', threadId, input: { content: [{ type: 'text', text: '六' }], mentions: [] } })
    const req = (await approval) as Extract<Event, { type: 'approval.requested' }>
    await bridge.invoke('agent:submit', { type: 'approval.resolve', threadId, approvalId: req.approvalId as ApprovalId, decision: 'deny' })
    await denied
    await completed
  })

  it('turn.interrupt aborts and thread.compact folds history', async () => {
    const threadId = await createThread(bridge)
    const aborted = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'turn.aborted')
    await bridge.invoke('agent:submit', { type: 'turn.start', threadId, input: { content: [{ type: 'text', text: '很长的任务' }], mentions: [] } })
    await bridge.invoke('agent:submit', { type: 'turn.interrupt', threadId })
    expect(((await aborted) as Extract<Event, { type: 'turn.aborted' }>).reason).toBe('interrupted')
    await runTurn(bridge, threadId, '再来一轮')
    const compacted = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'context.compacted')
    await bridge.invoke('agent:submit', { type: 'thread.compact', threadId })
    await compacted
    const { items } = await bridge.invoke('agent:getThread', { threadId })
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('compaction_summary')
  })

  it('clones a contact and chats with the persona', async () => {
    const list = await bridge.invoke('clone:list', undefined)
    expect(list).toHaveLength(26)
    const target = [...list].sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))[0]!
    expect(target.status.state).toBe('none')
    const ready = waitFor(bridge, 'clone:status', (s) => s.contactId === target.contactId && s.status.state === 'ready')
    await bridge.invoke('clone:start', { contactId: target.contactId })
    await ready
    const profile = await bridge.invoke('clone:get', { contactId: target.contactId })
    expect(profile?.card.tone.length).toBeGreaterThan(0)
    expect(profile?.samples.length).toBeGreaterThan(0)
    const threadId = newThreadId()
    const replied = waitFor(bridge, 'agent:event', (e) => e.threadId === threadId && e.type === 'turn.completed')
    await bridge.invoke('clone:chat', { contactId: target.contactId, threadId, text: '在吗' })
    const done = (await replied) as Extract<Event, { type: 'turn.completed' }>
    expect(done.finalText.length).toBeGreaterThan(0)
    expect(await bridge.invoke('clone:delete', { contactId: target.contactId })).toEqual({ affectedRules: [] })
  })

  it('auto-reply rules produce drafts and records', async () => {
    const { items } = await bridge.invoke('substrate:listSessions', { limit: 1, kind: 'dm' })
    const sessionId = items[0]!.id
    await bridge.invoke('config:set', { autoReply: { countdownMs: 60_000 } })
    const draftEvent = waitFor(bridge, 'autoreply:draft', (d) => d.source.chatId === sessionId && d.state === 'pending')
    const rule = await bridge.invoke('autoreply:saveRule', {
      id: '',
      sessionId,
      enabled: true,
      source: 'fixed',
      fixedText: '{昵称}你好，现在是 {时间}，稍后回复',
      historyCount: 30,
      updatedAt: 0,
    })
    expect(rule.id).toBeTruthy()
    const draft = await draftEvent
    expect(draft.mode).toBe('auto')
    expect(draft.draft).toContain('稍后回复')
    expect(await bridge.invoke('autoreply:listDrafts', undefined)).toHaveLength(1)
    const record = waitFor(bridge, 'autoreply:record', (r) => r.sessionId === sessionId)
    await bridge.invoke('autoreply:resolveDraft', { draftId: draft.id, decision: 'approve' })
    expect((await record).status).toBe('sent')
    expect(await bridge.invoke('autoreply:listRecords', { sessionId })).toHaveLength(1)
    expect((await bridge.invoke('autoreply:listRules', undefined))[0]?.todayCount).toBe(1)
    expect((await bridge.invoke('autoreply:recall', { recordId: (await record).id })).ok).toBe(true)
  })

  it('memory files are seeded from the dataset and editable', async () => {
    const user = await bridge.invoke('memory:read', { file: 'USER' })
    expect(user).toContain(demoFixture.account.nickname ?? '')
    const changed = waitFor(bridge, 'memory:changed', (e) => e.file === 'MEMORY')
    await bridge.invoke('memory:write', { file: 'MEMORY', markdown: '# MEMORY\n\n- 新条目' })
    await changed
    expect(await bridge.invoke('memory:entries', { file: 'MEMORY' })).toEqual([{ index: 0, text: '新条目', source: 'user' }])
    const budget = await bridge.invoke('memory:budget', { file: 'MEMORY' })
    expect(budget.limitChars).toBeGreaterThan(budget.usedChars)
  })

  it('generates a diary from the day\'s messages and tests models', async () => {
    const day = new Date(NOW - 2 * 86_400_000)
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const progress: number[] = []
    const off = bridge.on('diary:progress', (p) => progress.push(p.fraction))
    const entry = await bridge.invoke('diary:generate', { date })
    off()
    expect(progress.at(-1)).toBe(1)
    expect(entry.date).toBe(date)
    expect(entry.cues.length).toBeGreaterThanOrEqual(3)
    expect(entry.markdown).toContain('## 记忆线索')
    expect(await bridge.invoke('diary:list', undefined)).toHaveLength(1)
    const provider = { id: 'p', kind: 'openai' as const, label: 'x', models: [] }
    expect((await bridge.invoke('ai:testModel', { provider, modelId: 'm' })).ok).toBe(true)
    expect((await bridge.invoke('ai:testModel', { provider: { ...provider, baseUrl: 'https://fail.example' }, modelId: 'm' })).ok).toBe(false)
  })
})
