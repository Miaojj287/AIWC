import type { ThreadSummary } from '@aiwc/protocol'
import type { Kernel, ThreadRecord } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import { SAFE_THREAD_EXPORT, THREAD_SEARCH_MARKS, ThreadExportOptionsSchema } from '@aiwc/protocol'
import { writeExport } from '../services/exporter'
import { renderThreadExport } from '../services/threadExport'
import { safeUsername } from '../services/diagnostics'
import { groupThreadHits, ROWS_PER_THREAD, searchLimit, searchQuery } from '../services/threadSearch'
import { guardRendererOp } from './agentOpGuard'
import type { Handle, HostBridge } from './register'
// `tr`, not `t`: handlers below name their thread records `t`.
import { t as tr } from '../i18n'

/** A page of the conversation history (the renderer asks for the next page with `offset`). */
const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200

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
    ...(r.archived ? { archived: true } : {}),
    contextRef: contextRefOf(r),
  }
}

/** The chip a desktop thread was opened on: stored in its origin; older threads only had a chat id. */
function contextRefOf(r: ThreadRecord): ThreadSummary['contextRef'] {
  if (r.origin.channel !== 'desktop') return undefined
  const stored = r.origin.contextRef
  if (stored) return { kind: stored.kind, id: stored.id, label: stored.label }
  return r.origin.chatId ? { kind: 'session', id: r.origin.chatId, label: r.title } : undefined
}

/** A listed thread's summary; an untitled one is named after its first prompt (a history row needs a name). */
export async function listedSummary(kernel: Pick<Kernel, 'getThread'>, r: ThreadRecord): Promise<ThreadSummary> {
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
    try {
      await kernel.submit(verdict.op)
    } catch (e) {
      // The kernel's refusal codes become a sentence; anything else passes through (register.ts localizes it).
      if ((e as { code?: unknown } | null)?.code === 'rollback_target_missing')
        throw new Error(tr('main.agent.rollbackTargetMissing'), { cause: e })
      throw e
    }
  })

  handle('agent:listThreads', async (opts) => {
    const records = await kernel.listThreads({
      channel: opts?.channel,
      query: opts?.query,
      limit: Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(opts?.limit ?? LIST_DEFAULT_LIMIT))),
      offset: Math.max(0, Math.floor(opts?.offset ?? 0)),
      nonEmpty: true,
    })
    return Promise.all(records.map((r) => listedSummary(kernel, r)))
  })

  handle('agent:searchThreads', async (req) => {
    const query = searchQuery(req?.query)
    if (!query) return []
    const limit = searchLimit(req?.limit)
    const hits = await kernel.searchThreads(query, {
      channel: 'desktop',
      limit: limit * ROWS_PER_THREAD,
      marks: THREAD_SEARCH_MARKS,
    })
    return groupThreadHits(hits, limit)
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
    return {
      summary,
      items: t.items,
      running: t.running,
      ...(t.pendingAsks?.length ? { pendingAsks: t.pendingAsks } : {}),
    }
  })

  handle('agent:renameThread', ({ threadId, title }) =>
    kernel.updateMeta(threadId, { title: title.trim() || tr('main.agent.untitledThread') }),
  )
  handle('agent:pinThread', ({ threadId, pinned }) => kernel.updateMeta(threadId, { pinned }))
  handle('agent:deleteThread', ({ threadId }) => kernel.removeThread(threadId))

  handle('agent:exportThread', async ({ threadId, options }) => {
    // Anything missing or malformed falls back to the privacy-safe choice for that field.
    const chosen = ThreadExportOptionsSchema.catch(SAFE_THREAD_EXPORT).parse(options ?? {})
    const t = await kernel.getThread(threadId)
    if (!t) throw new Error(tr('main.agent.threadNotFound'))
    const title = t.record.title || tr('main.agent.exportTitle')
    const out = renderThreadExport(title, t.items, chosen, { username: safeUsername() })
    return { path: writeExport(ctx.paths.exportsDir, t.record.title || 'agent-thread', out.ext, out.content) }
  })

  handle('agent:listSkills', () =>
    ctx.skills
      .list()
      .map((s) => ({ name: s.name, description: s.description, command: s.command ?? `/${s.name}`, source: s.source })),
  )

  handle('agent:listModels', () => ctx.models.list())
}
