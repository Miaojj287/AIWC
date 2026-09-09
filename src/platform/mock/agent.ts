/**
 * agent:* — in-memory threads and a scripted turn that mimics the kernel's event stream:
 * turn.started → text deltas → search_messages tool call → (every 3rd turn) a send_message
 * approval → context.usage → turn.completed. Interrupt aborts, compact folds history.
 * Sending is 高危, so it asks in every permission mode; the read tool never does.
 */
import {
  estimateTokens,
  newApprovalId,
  newCallId,
  newItemId,
  newStepId,
  newTurnId,
  type ApprovalDecision,
  type ApprovalId,
  type ContextUsage,
  type Event,
  type HistoryItem,
  type ItemId,
  type JsonValue,
  type Mention,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type ThreadSummary,
  type TurnId,
  type UserInput,
  type WxMessage,
} from '@aiwc/protocol'
import { isAborted, type HandlersFor, type MockContext } from './core'
import { searchableText } from './dataset'

interface ThreadRecord {
  summary: ThreadSummary
  items: HistoryItem[]
  turns: number
  running?: { turnId: TurnId; abort: AbortController }
  approvals: Map<ApprovalId, (d: ApprovalDecision) => void>
}

export interface ScriptedAgent extends HandlersFor<'agent'> {
  ensureThread(threadId: ThreadId, origin: ThreadOrigin, settings: Partial<ThreadSettings>): ThreadRecord
  /** Stream a canned assistant reply into a thread (used by clone:chat). */
  replyInThread(threadId: ThreadId, userText: string, reply: string): Promise<void>
  /** User + assistant messages recorded in a thread (used by clone:reflect's growth check). */
  messageCount(threadId: ThreadId): number
}

const TEXT_CHUNK_MS = 28
const FILLER_WORDS = /(帮我|请你|请|一下|看看|找找|找出|找|搜索|搜一搜|搜|查询|查一查|查|总结|整理|统计|告诉我|关于|的消息|的记录|的聊天|有没有|哪些|什么|最近|一周|上周|这周|上个月|这个月|里|吗|呢)/g

export function agentHandlers(ctx: MockContext): ScriptedAgent {
  const threads = new Map<ThreadId, ThreadRecord>()
  const emit = (e: Event) => ctx.emit('agent:event', e)

  const get = (threadId: ThreadId): ThreadRecord => {
    const rec = threads.get(threadId)
    if (!rec) throw new Error(`unknown thread: ${threadId}`)
    return rec
  }

  function ensureThread(threadId: ThreadId, origin: ThreadOrigin, settings: Partial<ThreadSettings>): ThreadRecord {
    const existing = threads.get(threadId)
    if (existing) return existing
    const now = ctx.now()
    const full: ThreadSettings = {
      permissionMode: settings.permissionMode ?? ctx.config().agent.permissionMode,
      profile: settings.profile ?? 'desktop-chat',
      allowAlways: settings.allowAlways ?? [...ctx.config().agent.allowAlways],
      model: settings.model ?? ctx.config().ai.defaultModel,
      title: settings.title,
    }
    const rec: ThreadRecord = {
      summary: { threadId, title: full.title ?? '新会话', origin, settings: full, createdAt: now, updatedAt: now, pinned: false },
      items: [],
      turns: 0,
      approvals: new Map(),
    }
    threads.set(threadId, rec)
    emit({ type: 'thread.created', threadId, settings: full, origin })
    return rec
  }

  function touch(rec: ThreadRecord) {
    rec.summary.updatedAt = ctx.now()
  }

  function usageFor(rec: ThreadRecord): ContextUsage {
    const history = rec.items.reduce((n, it) => n + estimateTokens(JSON.stringify(it)), 0)
    const system = 1800
    const memory = 600
    const references = rec.summary.contextRef ? 900 : 0
    const tools = 1200
    const max = modelWindow(rec)
    return { usedTokens: Math.min(max, system + memory + references + history + tools), maxTokens: max, breakdown: { system, memory, references, history, tools } }
  }

  function modelWindow(rec: ThreadRecord): number {
    const sel = rec.summary.settings.model
    if (!sel) return 128_000
    const provider = ctx.config().ai.providers.find((p) => p.id === sel.providerId)
    return provider?.models.find((m) => m.modelId === sel.modelId)?.contextWindow ?? 128_000
  }

  function modelFails(rec: ThreadRecord): boolean {
    const sel = rec.summary.settings.model
    if (!sel) return false
    const provider = ctx.config().ai.providers.find((p) => p.id === sel.providerId)
    return Boolean(provider?.baseUrl?.includes('fail'))
  }

  async function streamText(rec: ThreadRecord, turnId: TurnId, stepId: ReturnType<typeof newStepId>, text: string, signal: AbortSignal): Promise<ItemId> {
    const itemId = newItemId()
    emit({ type: 'text.start', threadId: rec.summary.threadId, turnId, itemId })
    for (let i = 0; i < text.length; ) {
      const size = ctx.rng.int(2, 6)
      const delta = text.slice(i, i + size)
      i += size
      emit({ type: 'text.delta', threadId: rec.summary.threadId, turnId, itemId, delta })
      await ctx.delay(TEXT_CHUNK_MS, signal)
    }
    emit({ type: 'text.end', threadId: rec.summary.threadId, turnId, itemId, text })
    rec.items.push({ type: 'assistant_message', id: itemId, turnId, stepId, createdAt: ctx.now(), text, modelId: rec.summary.settings.model?.modelId })
    return itemId
  }

  /** Pull a search keyword out of a Chinese request: drop request verbs / fillers, keep the topic. */
  function deriveQuery(text: string, mentions: Mention[]): string {
    const cleaned = text
      .replace(FILLER_WORDS, ' ')
      .replace(/[，。！？、；：“”‘’（）「」,.!?;:()\s]+/g, ' ')
      .trim()
    const tokens = cleaned.split(' ').filter((t) => t.length >= 2)
    const pick = tokens.find((t) => t.length <= 8) ?? tokens[0]
    if (pick) return pick.slice(0, 8)
    const fallback = text.replace(/\s+/g, '').slice(0, 8)
    return fallback || mentions[0]?.label || '最近'
  }

  function describe(m: WxMessage): string {
    const session = ctx.data.sessions.get(m.sessionId)
    const d = new Date(m.createdAt)
    return `${m.senderName ?? '对方'}（${session?.title ?? m.sessionId}，${d.getMonth() + 1}/${d.getDate()}）：${searchableText(m).slice(0, 40)}`
  }

  function searchDataset(query: string, sessionIds: string[] | undefined): WxMessage[] {
    const needle = query.toLowerCase()
    const scope = sessionIds && sessionIds.length ? sessionIds : [...ctx.data.sessions.keys()]
    const hits: WxMessage[] = []
    for (const sid of scope) for (const m of ctx.data.messagesBySession.get(sid) ?? []) if (searchableText(m).toLowerCase().includes(needle)) hits.push(m)
    return hits.sort((a, b) => b.createdAt - a.createdAt)
  }

  async function runTurn(rec: ThreadRecord, input: UserInput): Promise<void> {
    const threadId = rec.summary.threadId
    const turnId = newTurnId()
    const abort = new AbortController()
    const signal = abort.signal
    rec.running = { turnId, abort }
    rec.turns += 1
    const turnIndex = rec.turns
    const userText = input.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n').trim()
    const userItemId = newItemId()
    rec.items.push({ type: 'user_message', id: userItemId, turnId, createdAt: ctx.now(), content: input.content, mentions: input.mentions })
    emit({ type: 'item.user', threadId, turnId, itemId: userItemId, content: input.content, mentions: input.mentions })
    const sessionMention = input.mentions.find((m) => m.kind === 'session')
    if (sessionMention && !rec.summary.contextRef) rec.summary.contextRef = { kind: 'session', id: sessionMention.id, label: sessionMention.label }
    emit({ type: 'turn.started', threadId, turnId, at: ctx.now() })

    let steps = 0
    let finalText = ''
    try {
      if (modelFails(rec)) {
        await ctx.delay(500, signal)
        emit({
          type: 'error',
          threadId,
          turnId,
          error: { code: 'auth', message: '模型服务返回 401：API Key 无效或已过期', retryable: false },
          actions: [
            { label: '去改 Key', action: 'open_settings_ai' },
            { label: '重试', action: 'retry' },
          ],
        })
        rec.items.push({ type: 'turn_aborted', id: newItemId(), turnId, createdAt: ctx.now(), reason: 'error' })
        emit({ type: 'turn.aborted', threadId, turnId, reason: 'error' })
        return
      }

      const query = deriveQuery(userText, input.mentions)
      const scopeIds = input.mentions.filter((m) => m.kind === 'session').map((m) => m.id)
      const scopeLabel = scopeIds.length ? `「${input.mentions.find((m) => m.kind === 'session')?.label ?? ''}」` : '全部会话'

      // ---- step 0: announce + search tool --------------------------------------------------
      const step0 = newStepId()
      steps++
      emit({ type: 'step.started', threadId, turnId, stepId: step0, index: 0 })

      await streamText(rec, turnId, step0, `我先在${scopeLabel}里搜索“${query}”相关的记录。`, signal)
      const callId = newCallId()
      const toolInput: JsonValue = { query, sessionIds: scopeIds, limit: 20 }
      const startedAt = ctx.now()
      const base = { type: 'tool.call' as const, threadId, turnId, stepId: step0, callId, toolName: 'search_messages', summary: `搜索“${query}”`, input: toolInput, risk: 'read' as const, startedAt }
      emit({ ...base, status: 'pending' })
      rec.items.push({ type: 'tool_call', id: newItemId(), turnId, stepId: step0, createdAt: startedAt, callId, toolName: 'search_messages', input: toolInput })
      await ctx.delay(150, signal)
      emit({ ...base, status: 'running' })
      await ctx.delay(ctx.rng.int(450, 900), signal)
      const hits = searchDataset(query, scopeIds)
      const output: JsonValue = { total: hits.length, hits: hits.slice(0, 5).map((m) => ({ sessionId: m.sessionId, messageId: m.id, at: m.createdAt, sender: m.senderName ?? '', text: searchableText(m).slice(0, 80) })) }
      const durationMs = ctx.now() - startedAt
      emit({ ...base, status: 'done', durationMs, output })
      rec.items.push({ type: 'tool_result', id: newItemId(), turnId, stepId: step0, createdAt: ctx.now(), callId, toolName: 'search_messages', output: { type: 'json', value: output }, isError: false, durationMs, truncated: false })

      // ---- approval demo: sending is 高危, so it asks in every mode -----------------------
      if (turnIndex % 3 === 0 && !rec.summary.settings.allowAlways.includes('send_message')) {
        const target = hits[0] ? ctx.data.sessions.get(hits[0].sessionId) : [...ctx.data.sessions.values()][0]
        if (target) {
          const sendCall = newCallId()
          const approvalId = newApprovalId()
          const draft = `关于“${query}”的整理我发你一份摘要，稍后看。`
          const sendInput: JsonValue = { to: target.id, text: draft }
          const sendBase = { type: 'tool.call' as const, threadId, turnId, stepId: step0, callId: sendCall, toolName: 'send_message', summary: `发送消息到「${target.title}」`, input: sendInput, risk: 'send' as const, startedAt: ctx.now() }
          emit({ ...sendBase, status: 'awaiting_approval' })
          emit({ type: 'approval.requested', threadId, turnId, approvalId, callId: sendCall, toolName: 'send_message', summary: `发送消息到「${target.title}」`, detail: draft, input: sendInput, risk: 'send', canAllowAlways: true })
          const decision = await waitApproval(rec, approvalId, signal)
          if (decision === 'deny') {
            emit({ ...sendBase, status: 'denied', durationMs: 0, output: '用户拒绝了此操作', isError: true })
          } else {
            if (decision === 'allow_always' && !rec.summary.settings.allowAlways.includes('send_message')) {
              rec.summary.settings.allowAlways.push('send_message')
              emit({ type: 'thread.settings', threadId, settings: rec.summary.settings })
            }
            emit({ ...sendBase, status: 'running' })
            await ctx.delay(600, signal)
            emit({ ...sendBase, status: 'done', durationMs: 600, output: { ok: true, messageId: ctx.id('sent') } })
          }
        }
      }

      // ---- step 1: final answer -------------------------------------------------------------
      const step1 = newStepId()
      steps++
      emit({ type: 'step.started', threadId, turnId, stepId: step1, index: 1 })
      const sessionsHit = new Set(hits.map((m) => m.sessionId)).size
      finalText = hits.length
        ? `在 ${sessionsHit} 个会话里找到 ${hits.length} 条和“${query}”相关的消息。最近的几条：\n${hits.slice(0, 3).map((m) => `- ${describe(m)}`).join('\n')}\n\n需要我按会话整理成摘要，或者只看某个人说的部分吗？`
        : `没有找到和“${query}”直接相关的消息。可以换个关键词，或者用 @ 引用具体会话再试。`
      await streamText(rec, turnId, step1, finalText, signal)

      emit({ type: 'context.usage', threadId, usage: usageFor(rec) })
      emit({ type: 'turn.completed', threadId, turnId, finalText, usage: { inputTokens: usageFor(rec).usedTokens, outputTokens: estimateTokens(finalText) }, steps, at: ctx.now() })
      if (turnIndex === 1 && !rec.summary.settings.title) {
        rec.summary.title = userText.slice(0, 20) || '新会话'
        emit({ type: 'thread.title', threadId, title: rec.summary.title })
      }
    } catch (err) {
      if (isAborted(err)) {
        rec.items.push({ type: 'turn_aborted', id: newItemId(), turnId, createdAt: ctx.now(), reason: 'interrupted' })
        emit({ type: 'turn.aborted', threadId, turnId, reason: 'interrupted' })
      } else {
        emit({ type: 'error', threadId, turnId, error: { code: 'unknown', message: err instanceof Error ? err.message : String(err), retryable: true }, actions: [{ label: '重试', action: 'retry' }] })
        emit({ type: 'turn.aborted', threadId, turnId, reason: 'error' })
      }
    } finally {
      if (rec.running?.turnId === turnId) rec.running = undefined
      touch(rec)
    }
  }

  function waitApproval(rec: ThreadRecord, approvalId: ApprovalId, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        rec.approvals.delete(approvalId)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      rec.approvals.set(approvalId, (d) => {
        signal.removeEventListener('abort', onAbort)
        rec.approvals.delete(approvalId)
        resolve(d)
      })
    })
  }

  function interrupt(rec: ThreadRecord) {
    rec.running?.abort.abort()
    rec.running = undefined
  }

  async function dispatch(op: Op): Promise<void> {
    switch (op.type) {
      case 'thread.create':
        ensureThread(op.threadId, op.origin, op.settings)
        return
      case 'turn.start': {
        const rec = get(op.threadId)
        if (rec.running && op.mode === 'steer') {
          const itemId = newItemId()
          rec.items.push({ type: 'user_message', id: itemId, turnId: rec.running.turnId, createdAt: ctx.now(), content: op.input.content, mentions: op.input.mentions })
          emit({ type: 'item.user', threadId: op.threadId, turnId: rec.running.turnId, itemId, content: op.input.content, mentions: op.input.mentions })
          return
        }
        if (rec.running) interrupt(rec)
        void runTurn(rec, op.input)
        return
      }
      case 'turn.interrupt':
        interrupt(get(op.threadId))
        return
      case 'approval.resolve': {
        const rec = get(op.threadId)
        rec.approvals.get(op.approvalId)?.(op.decision)
        emit({ type: 'approval.resolved', threadId: op.threadId, approvalId: op.approvalId, decision: op.decision })
        return
      }
      case 'thread.settings': {
        const rec = get(op.threadId)
        rec.summary.settings = { ...rec.summary.settings, ...op.patch }
        if (op.patch.title) rec.summary.title = op.patch.title
        touch(rec)
        emit({ type: 'thread.settings', threadId: op.threadId, settings: rec.summary.settings })
        return
      }
      case 'thread.compact': {
        const rec = get(op.threadId)
        if (rec.items.length === 0) return
        const before = usageFor(rec).usedTokens
        const last = rec.items[rec.items.length - 1] as HistoryItem
        const userLines = rec.items.filter((i) => i.type === 'user_message').length
        const summary = `此前 ${userLines} 轮对话的摘要：用户主要在查询微信聊天记录中的关键词并要求整理；已调用 search_messages ${rec.items.filter((i) => i.type === 'tool_call').length} 次。`
        const item: HistoryItem = { type: 'compaction_summary', id: newItemId(), createdAt: ctx.now(), summary, foldedItemCount: rec.items.length, foldedThroughId: last.id, tokenEstimate: estimateTokens(summary) }
        rec.items = [item]
        const after = usageFor(rec)
        emit({ type: 'context.compacted', threadId: op.threadId, summaryItemId: item.id, freedTokens: Math.max(0, before - after.usedTokens) })
        emit({ type: 'context.usage', threadId: op.threadId, usage: after })
        return
      }
      case 'thread.rollback': {
        const rec = get(op.threadId)
        const turnIds = [...new Set(rec.items.filter((i) => 'turnId' in i && i.turnId).map((i) => (i as { turnId: TurnId }).turnId))]
        const drop = new Set(turnIds.slice(-op.turns))
        rec.items = rec.items.filter((i) => !('turnId' in i && i.turnId && drop.has(i.turnId as TurnId)))
        rec.turns = Math.max(0, rec.turns - op.turns)
        emit({ type: 'context.usage', threadId: op.threadId, usage: usageFor(rec) })
        return
      }
      case 'thread.clear': {
        const rec = get(op.threadId)
        interrupt(rec)
        rec.items = []
        rec.turns = 0
        emit({ type: 'context.usage', threadId: op.threadId, usage: usageFor(rec) })
        return
      }
      case 'thread.shutdown':
        interrupt(get(op.threadId))
        return
    }
  }

  const handlers: HandlersFor<'agent'> = {
    'agent:submit': (op) => dispatch(op),
    'agent:listThreads': ({ query, limit, channel }) => {
      const needle = query?.trim().toLowerCase()
      const list = [...threads.values()]
        .map((t) => t.summary)
        .filter((s) => !channel || s.origin.channel === channel)
        .filter((s) => !needle || s.title.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
      return limit ? list.slice(0, limit) : list
    },
    'agent:getThread': ({ threadId }) => {
      const rec = get(threadId)
      return { summary: rec.summary, items: [...rec.items] }
    },
    'agent:renameThread': ({ threadId, title }) => {
      const rec = get(threadId)
      rec.summary.title = title
      rec.summary.settings.title = title
      touch(rec)
      emit({ type: 'thread.title', threadId, title })
    },
    'agent:pinThread': ({ threadId, pinned }) => {
      get(threadId).summary.pinned = pinned
    },
    'agent:deleteThread': ({ threadId }) => {
      const rec = threads.get(threadId)
      if (rec) interrupt(rec)
      threads.delete(threadId)
    },
    'agent:exportThread': async ({ threadId }) => {
      const rec = get(threadId)
      await ctx.delay(400)
      return { path: `~/Downloads/AIWC 导出/${rec.summary.title}.md` }
    },
    'agent:listSkills': () => [
      { name: 'weekly_report', description: '按会话整理最近一周的要点', command: '/周报', source: 'builtin' },
      { name: 'summarize_session', description: '总结当前引用的会话', command: '/总结', source: 'builtin' },
      { name: 'find_files', description: '找出会话里共享过的文件', command: '/找文件', source: 'builtin' },
    ],
    'agent:listModels': () => {
      const cfg = ctx.config()
      const out = cfg.ai.providers.flatMap((p) =>
        p.models
          .filter((m) => m.enabled !== false)
          .map((m) => ({ providerId: p.id, modelId: m.modelId, label: m.label, providerLabel: p.label, vendor: p.vendor, contextWindow: m.contextWindow, local: p.kind === 'ollama', supportsTools: m.supportsTools, reasoningEffort: m.reasoningEffort })),
      )
      if (out.length === 0) out.push({ providerId: 'demo', modelId: 'demo-local', label: '演示模型（本地）', providerLabel: '演示', vendor: undefined, contextWindow: 128_000, local: true, supportsTools: true, reasoningEffort: undefined })
      return out
    },
    'agent:suggestPrompts': ({ contextRef }) => {
      if (contextRef?.kind === 'session') return [`总结「${contextRef.label}」最近一周聊了什么`, `找出「${contextRef.label}」里还没回复的问题`, `把「${contextRef.label}」里提到的时间和地点列出来`]
      if (contextRef?.kind === 'contact') return [`${contextRef.label} 最近关心什么`, `我和 ${contextRef.label} 上次聊到哪了`]
      if (contextRef?.kind === 'file') return [`概括这个文件的要点`, `把文件里的待办整理出来`]
      return ['最近一周哪些群最活跃', '帮我找一下上个月提到“会议”的消息', '统计我和谁聊得最多']
    },
  }

  return {
    ...handlers,
    ensureThread,
    messageCount(threadId) {
      return (threads.get(threadId)?.items ?? []).filter((it) => it.type === 'user_message' || it.type === 'assistant_message').length
    },
    async replyInThread(threadId, userText, reply) {
      const rec = get(threadId)
      const turnId = newTurnId()
      const itemId = newItemId()
      const content: UserInput['content'] = [{ type: 'text', text: userText }]
      rec.items.push({ type: 'user_message', id: itemId, turnId, createdAt: ctx.now(), content, mentions: [] })
      emit({ type: 'item.user', threadId, turnId, itemId, content, mentions: [] })
      emit({ type: 'turn.started', threadId, turnId, at: ctx.now() })
      const stepId = newStepId()
      emit({ type: 'step.started', threadId, turnId, stepId, index: 0 })
      await ctx.delay(ctx.rng.int(300, 800))
      await streamText(rec, turnId, stepId, reply, new AbortController().signal)
      touch(rec)
      emit({ type: 'turn.completed', threadId, turnId, finalText: reply, usage: { inputTokens: estimateTokens(userText), outputTokens: estimateTokens(reply) }, steps: 1, at: ctx.now() })
    },
  }
}
