import type { ThreadSummary } from '@aiwc/protocol'
import type { ThreadRecord } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import { threadToMarkdown, writeExport } from '../services/exporter'
import { guardRendererOp } from './agentOpGuard'
import type { Handle, HostBridge } from './register'

export function toThreadSummary(r: ThreadRecord): ThreadSummary {
  return {
    threadId: r.threadId,
    title: r.title,
    origin: r.origin,
    settings: r.settings,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pinned: r.pinned,
    contextRef: r.origin.channel === 'desktop' && r.origin.chatId ? { kind: 'session', id: r.origin.chatId, label: r.title } : undefined,
  }
}

/** Starter prompts shown in an empty Agent thread. UI copy, not data. */
export function suggestPrompts(kind: 'session' | 'file' | 'contact' | undefined): string[] {
  switch (kind) {
    case 'session':
      return ['总结这个会话最近一周聊了什么，按主题分组并给出锚点', '找出对方问了但我还没回复的消息', '这个会话里最常出现的话题和时间段是什么']
    case 'contact':
      return ['根据聊天记录概括我和这个人的关系与近期互动', '这个人最近有没有提到需要我跟进的事', '用这个人的口吻起草一条回复']
    case 'file':
      return ['概括这个文件的要点', '把这个文件整理成一份可以发出去的说明', '根据文件内容列出待办事项']
    default:
      return ['今天有哪些未回复的重要消息', '生成本周的聊天周报', '搜索最近提到「会议」的消息并整理时间线']
  }
}

export function registerAgentIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { kernel } = ctx
  const log = ctx.logger.child('ipc:agent')

  // The Op is validated and policy-checked here (agentOpGuard) — the kernel trusts its callers.
  handle('agent:submit', async (raw) => {
    const verdict = await guardRendererOp(raw, {
      lookupOrigin: async (threadId) => (await kernel.getThread(threadId))?.record.origin,
    })
    if (!verdict.ok) {
      const type = typeof (raw as { type?: unknown } | null)?.type === 'string' ? (raw as { type: string }).type : '?'
      log.warn(`agent:submit rejected (${verdict.code})`, { type, threadId: verdict.threadId, message: verdict.message })
      if (verdict.threadId) {
        ctx.broadcast('agent:event', {
          type: 'error',
          threadId: verdict.threadId,
          error: { code: verdict.code, message: verdict.message, retryable: false },
          actions: [{ label: '知道了', action: 'dismiss' }],
        })
      }
      throw new Error(verdict.message)
    }
    await kernel.submit(verdict.op)
  })

  handle('agent:listThreads', async (opts) => {
    const records = await kernel.listThreads({ ...opts, limit: undefined })
    const summaries = await Promise.all(records.filter((r) => r.itemCount > 0).map(async (r) => {
      if (r.title.trim() && r.title !== '新会话') return toThreadSummary(r)
      const thread = await kernel.getThread(r.threadId)
      const first = thread?.items.find((item) => item.type === 'user_message')
      const title = first?.type === 'user_message'
        ? first.content.map((part) => part.type === 'text' ? part.text : '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 24) || first.mentions[0]?.label || '附件会话'
        : '会话记录'
      return toThreadSummary({ ...r, title })
    }))
    return summaries.slice(0, opts?.limit ?? 50)
  })

  handle('agent:getThread', async ({ threadId }) => {
    const t = await kernel.getThread(threadId)
    if (!t) throw new Error('会话不存在或已被删除')
    const summary = toThreadSummary(t.record)
    if (!summary.title.trim() || summary.title === '新会话') {
      const first = t.items.find((item) => item.type === 'user_message')
      if (first?.type === 'user_message') summary.title = first.content.map((part) => part.type === 'text' ? part.text : '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 24) || first.mentions[0]?.label || '附件会话'
    }
    return { summary, items: t.items }
  })

  handle('agent:renameThread', ({ threadId, title }) => kernel.updateMeta(threadId, { title: title.trim() || '未命名会话' }))
  handle('agent:pinThread', ({ threadId, pinned }) => kernel.updateMeta(threadId, { pinned }))
  handle('agent:deleteThread', ({ threadId }) => kernel.removeThread(threadId))

  handle('agent:exportThread', async ({ threadId }) => {
    const t = await kernel.getThread(threadId)
    if (!t) throw new Error('会话不存在或已被删除')
    const path = writeExport(ctx.paths.exportsDir, t.record.title || 'agent-thread', 'md', threadToMarkdown(t.record.title || 'Agent 会话', t.items))
    return { path }
  })

  handle('agent:listSkills', () =>
    ctx.skills.list().map((s) => ({ name: s.name, description: s.description, command: s.command ?? `/${s.name}`, source: s.source })),
  )

  handle('agent:listModels', () => ctx.models.list())

  handle('agent:suggestPrompts', ({ contextRef }) => suggestPrompts(contextRef?.kind))
}
