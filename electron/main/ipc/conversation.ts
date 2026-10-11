/**
 * Agent conversation channels beyond the Op funnel (packages/protocol/src/ipcDomains/conversation.ts): archiving a
 * thread, the 已归档 list, and forking a thread at a turn. Input is validated here; every channel acts on desktop
 * threads only — bot / cron threads are host-owned (same rule as agentOpGuard).
 */
import { z } from 'zod'
import type { ItemId, ThreadId } from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import { listedSummary, toThreadSummary } from './agent'
import type { Handle, HostBridge } from './register'

const ARCHIVED_DEFAULT_LIMIT = 50
const ARCHIVED_MAX_LIMIT = 200

const id = z.string().min(1).max(128)
const archiveReq = z.strictObject({ threadId: id, archived: z.boolean() })
const listReq = z
  .strictObject({ limit: z.number().int().min(1).optional(), offset: z.number().int().min(0).optional() })
  .optional()
const forkReq = z.strictObject({ threadId: id, throughItemId: id, title: z.string().max(200) })

/** Kernel refusal codes of forkThread (packages/kernel/src/runtime/fork.ts) → the sentence the user sees. */
const FORK_REFUSALS = {
  fork_target_missing: 'main.agent.fork.targetMissing',
  fork_turn_running: 'main.agent.fork.turnRunning',
} as const

type ConversationKernel = Pick<Kernel, 'getThread' | 'updateMeta' | 'listThreads' | 'forkThread'>

/** Throws unless `threadId` is an existing desktop thread. */
async function requireDesktopThread(kernel: ConversationKernel, threadId: ThreadId): Promise<void> {
  const thread = await kernel.getThread(threadId)
  if (!thread) throw new Error(t('main.agent.threadNotFound'))
  if (thread.record.origin.channel !== 'desktop') throw new Error(t('main.agent.conversation.desktopOnly'))
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new Error(t('main.agent.conversation.invalidRequest'))
  return parsed.data
}

export function registerConversationIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const kernel: ConversationKernel = ctx.kernel

  handle('agent:archiveThread', async (raw) => {
    const req = parse(archiveReq, raw)
    const threadId = req.threadId as ThreadId
    await requireDesktopThread(kernel, threadId)
    await kernel.updateMeta(threadId, { archived: req.archived })
  })

  handle('agent:listArchivedThreads', async (raw) => {
    const req = parse(listReq, raw)
    const records = await kernel.listThreads({
      channel: 'desktop',
      archivedOnly: true,
      nonEmpty: true,
      limit: Math.min(ARCHIVED_MAX_LIMIT, req?.limit ?? ARCHIVED_DEFAULT_LIMIT),
      offset: req?.offset ?? 0,
    })
    return Promise.all(records.map((r) => listedSummary(kernel, r)))
  })

  handle('agent:forkThread', async (raw) => {
    const req = parse(forkReq, raw)
    const source = req.threadId as ThreadId
    await requireDesktopThread(kernel, source)
    let threadId: ThreadId
    try {
      threadId = await kernel.forkThread(source, {
        throughItemId: req.throughItemId as ItemId,
        title: req.title.trim() || t('main.agent.untitledThread'),
      })
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code
      const key =
        typeof code === 'string' && code in FORK_REFUSALS
          ? FORK_REFUSALS[code as keyof typeof FORK_REFUSALS]
          : undefined
      if (key) throw new Error(t(key), { cause: e })
      throw e
    }
    const forked = await kernel.getThread(threadId)
    if (!forked) throw new Error(t('main.agent.threadNotFound'))
    return toThreadSummary(forked.record)
  })
}
