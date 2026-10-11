/**
 * privacy:* in the web preview and tests: grants come from the mock config (global) and the mock threads' settings,
 * the OS permissions read as granted, and the change journal starts empty (the mock kernel runs no tools).
 */
import type { AgentGrant, AgentChange, ThreadId } from '@aiwc/protocol'
import type { Handlers, HandlersFor, MockContext } from './core'

type AgentMock = Pick<Handlers, 'agent:listThreads' | 'agent:submit'>

export function privacyHandlers(ctx: MockContext, deps: { agent: AgentMock }): HandlersFor<'privacy'> {
  const changes: AgentChange[] = []
  const desktopThreads = async () => deps.agent['agent:listThreads']({ channel: 'desktop' })
  return {
    'privacy:listGrants': async () => {
      const grants: AgentGrant[] = ctx.config().agent.allowAlways.map((key) => ({ scope: 'global', key }))
      for (const thread of await desktopThreads())
        for (const key of thread.settings.allowAlways)
          grants.push({ scope: 'thread', key, threadId: thread.threadId, threadTitle: thread.title })
      return grants
    },
    'privacy:revokeGrant': async ({ scope, key, threadId }) => {
      if (scope === 'global') {
        ctx.setConfig({ agent: { allowAlways: ctx.config().agent.allowAlways.filter((k) => k !== key) } })
      } else {
        const thread = (await desktopThreads()).find((t) => t.threadId === threadId)
        if (!thread) throw new Error('thread not found')
        await deps.agent['agent:submit']({
          type: 'thread.settings',
          threadId: thread.threadId,
          patch: { allowAlways: thread.settings.allowAlways.filter((k) => k !== key) },
        })
      }
      ctx.emit('privacy:grantsChanged', { scope, ...(threadId ? { threadId } : {}) })
    },
    'privacy:autoSendPermissions': () => ({
      platform: ctx.platform === 'win32' ? 'win32' : ctx.platform === 'darwin' ? 'darwin' : 'linux',
      accessibility: ctx.platform === 'darwin' ? 'granted' : 'not-applicable',
      automation: ctx.platform === 'darwin' ? 'granted' : 'not-applicable',
      ready: ctx.platform !== 'linux',
      checkedAt: ctx.now(),
    }),
    'privacy:listChanges': ({ threadId }: { threadId: ThreadId }) => changes.filter((c) => c.threadId === threadId),
    'privacy:undoChange': ({ id }) => {
      const change = changes.find((c) => c.id === id)
      if (!change) return { ok: false, reason: 'not_found' }
      if (!change.undoable) return { ok: false, reason: 'not_undoable' }
      change.undoneAt = ctx.now()
      ctx.emit('privacy:changes', { threadId: change.threadId, turnId: change.turnId })
      return { ok: true }
    },
  }
}
