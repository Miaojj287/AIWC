import type { ThreadSummary } from '@aiwc/protocol'
import type { ThreadRecord } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import { threadToMarkdown, writeExport } from '../services/exporter'
import { guardRendererOp } from './agentOpGuard'
import type { Handle, HostBridge } from './register'
// `tr`, not `t`: handlers below name their thread records `t`.
import { t as tr } from '../i18n'

/** Placeholder title older builds stored for untitled threads — data persisted in rollouts, not copy. */
// eslint-disable-next-line aiwc/no-hardcoded-cjk -- legacy sentinel value read from user data
const LEGACY_UNTITLED = '新会话'

export function toThreadSummary(r: ThreadRecord): ThreadSummary {
  return {
    threadId: r.threadId,
    title: r.title,
    origin: r.origin,
    settings: r.settings,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pinned: r.pinned,
    contextRef:
      r.origin.channel === 'desktop' && r.origin.chatId
        ? { kind: 'session', id: r.origin.chatId, label: r.title }
        : undefined,
  }
}

/** Starter prompts shown in an empty Agent thread. UI copy, not data. */
export function suggestPrompts(kind: 'session' | 'file' | 'contact' | undefined): string[] {
  switch (kind) {
    case 'session':
      return [
        tr('main.agent.suggestions.sessionSummary'),
        tr('main.agent.suggestions.sessionUnanswered'),
        tr('main.agent.suggestions.sessionTopics'),
      ]
    case 'contact':
      return [
        tr('main.agent.suggestions.contactRelationship'),
        tr('main.agent.suggestions.contactFollowUps'),
        tr('main.agent.suggestions.contactDraftReply'),
      ]
    case 'file':
      return [
        tr('main.agent.suggestions.fileKeyPoints'),
        tr('main.agent.suggestions.fileShareable'),
        tr('main.agent.suggestions.fileTodos'),
      ]
    default:
      return [
        tr('main.agent.suggestions.generalUnanswered'),
        tr('main.agent.suggestions.generalWeekly'),
        tr('main.agent.suggestions.generalMeetings'),
      ]
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
      log.warn(`agent:submit rejected (${verdict.code})`, {
        type,
        threadId: verdict.threadId,
        message: verdict.message,
      })
      if (verdict.threadId) {
        ctx.broadcast('agent:event', {
          type: 'error',
          threadId: verdict.threadId,
          error: { code: verdict.code, message: verdict.message, retryable: false },
          actions: [{ label: tr('main.agent.gotIt'), action: 'dismiss' }],
        })
      }
      throw new Error(verdict.message)
    }
    await kernel.submit(verdict.op)
  })

  handle('agent:listThreads', async (opts) => {
    const records = await kernel.listThreads({ ...opts, limit: undefined })
    const summaries = await Promise.all(
      records
        .filter((r) => r.itemCount > 0)
        .map(async (r) => {
          if (r.title.trim() && r.title !== LEGACY_UNTITLED) return toThreadSummary(r)
          const thread = await kernel.getThread(r.threadId)
          const first = thread?.items.find((item) => item.type === 'user_message')
          const title =
            first?.type === 'user_message'
              ? first.content
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join(' ')
                  .trim()
                  .replace(/\s+/g, ' ')
                  .slice(0, 24) ||
                first.mentions[0]?.label ||
                tr('main.agent.attachmentThread')
              : tr('main.agent.threadRecord')
          return toThreadSummary({ ...r, title })
        }),
    )
    return summaries.slice(0, opts?.limit ?? 50)
  })

  handle('agent:getThread', async ({ threadId }) => {
    const t = await kernel.getThread(threadId)
    if (!t) throw new Error(tr('main.agent.threadNotFound'))
    const summary = toThreadSummary(t.record)
    if (!summary.title.trim() || summary.title === LEGACY_UNTITLED) {
      const first = t.items.find((item) => item.type === 'user_message')
      if (first?.type === 'user_message')
        summary.title =
          first.content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join(' ')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 24) ||
          first.mentions[0]?.label ||
          tr('main.agent.attachmentThread')
    }
    return { summary, items: t.items }
  })

  handle('agent:renameThread', ({ threadId, title }) =>
    kernel.updateMeta(threadId, { title: title.trim() || tr('main.agent.untitledThread') }),
  )
  handle('agent:pinThread', ({ threadId, pinned }) => kernel.updateMeta(threadId, { pinned }))
  handle('agent:deleteThread', ({ threadId }) => kernel.removeThread(threadId))

  handle('agent:exportThread', async ({ threadId }) => {
    const t = await kernel.getThread(threadId)
    if (!t) throw new Error(tr('main.agent.threadNotFound'))
    const path = writeExport(
      ctx.paths.exportsDir,
      t.record.title || 'agent-thread',
      'md',
      threadToMarkdown(t.record.title || tr('main.agent.exportTitle'), t.items),
    )
    return { path }
  })

  handle('agent:listSkills', () =>
    ctx.skills
      .list()
      .map((s) => ({ name: s.name, description: s.description, command: s.command ?? `/${s.name}`, source: s.source })),
  )

  handle('agent:listModels', () => ctx.models.list())

  handle('agent:suggestPrompts', ({ contextRef }) => suggestPrompts(contextRef?.kind))
}
