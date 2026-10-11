/**
 * 总是允许 grants (设置 › AI 接入 › 权限规则): global ones live in `agent.allowAlways` and apply to every desktop
 * thread at call time; thread ones live in each thread's settings — desktop threads and the phone thread (我的微信 ›
 * 遥控, origin 'wechat-remote'), whose "2" answers build its own list. This service lists both, adds global ones when
 * an approval is answered with scope 'global', and revokes either kind (the renderer may not touch the phone thread's
 * settings, so its grants are revoked here, in main).
 */
import {
  GRANT_KEY_RE,
  type AgentGrant,
  type AppConfig,
  type ConfigPatch,
  type GrantScope,
  type Op,
  type ThreadId,
} from '@aiwc/protocol'

/** Threads scanned per listing (active + archived): grants are rare, a listing never needs more. */
const MAX_THREADS_SCANNED = 500

/** Channels whose threads carry user grants: the desktop and the owner's phone. */
const GRANT_CHANNELS = ['desktop', 'wechat-remote'] as const
type GrantChannel = (typeof GRANT_CHANNELS)[number]

interface ThreadGrantRecord {
  threadId: ThreadId
  title: string
  origin: { channel: string }
  settings: { allowAlways: string[] }
}

export interface GrantServiceDeps {
  config: { get(): AppConfig; set(patch: ConfigPatch): AppConfig }
  kernel: {
    listThreads(opts: { limit: number; channel?: GrantChannel; archivedOnly?: boolean }): Promise<ThreadGrantRecord[]>
    submit(op: Op): Promise<void>
  }
  /** Tell open windows the list changed (permission-rules page, approval toasts). */
  onChange?: (scope: GrantScope, threadId?: ThreadId) => void
}

export interface GrantService {
  /** Persist a global grant (approval answered 总是允许 · 所有会话). Invalid keys are ignored. */
  addGlobal(key: string): void
  list(): Promise<AgentGrant[]>
  revoke(req: { scope: GrantScope; key: string; threadId?: ThreadId }): Promise<void>
}

export function createGrantService(deps: GrantServiceDeps): GrantService {
  const globalKeys = (): string[] => deps.config.get().agent.allowAlways

  /** Every thread that may carry grants, active and archived. */
  const grantThreads = async (): Promise<ThreadGrantRecord[]> => {
    const lists = await Promise.all(
      GRANT_CHANNELS.flatMap((channel) => [
        deps.kernel.listThreads({ limit: MAX_THREADS_SCANNED, channel }),
        deps.kernel.listThreads({ limit: MAX_THREADS_SCANNED, channel, archivedOnly: true }),
      ]),
    )
    return lists.flat()
  }

  return {
    addGlobal(key) {
      if (!GRANT_KEY_RE.test(key) || globalKeys().includes(key)) return
      deps.config.set({ agent: { allowAlways: [...globalKeys(), key] } })
      deps.onChange?.('global')
    },

    async list() {
      const grants: AgentGrant[] = globalKeys().map((key) => ({ scope: 'global', key }))
      for (const record of await grantThreads()) {
        const phone = record.origin.channel === 'wechat-remote'
        for (const key of record.settings.allowAlways)
          grants.push({
            scope: 'thread',
            key,
            threadId: record.threadId,
            threadTitle: record.title,
            ...(phone ? { phone: true as const } : {}),
          })
      }
      return grants
    },

    async revoke({ scope, key, threadId }) {
      if (scope === 'global') {
        const next = globalKeys().filter((k) => k !== key)
        if (next.length !== globalKeys().length) deps.config.set({ agent: { allowAlways: next } })
        deps.onChange?.('global')
        return
      }
      if (!threadId) throw new Error('threadId is required to revoke a thread grant')
      const record = (await grantThreads()).find((r) => r.threadId === threadId)
      // Only desktop and phone threads carry user grants; anything else (or an unknown id) is refused, not ignored.
      if (!record) throw new Error('thread not found')
      const allowAlways = record.settings.allowAlways.filter((k) => k !== key)
      if (allowAlways.length !== record.settings.allowAlways.length)
        await deps.kernel.submit({ type: 'thread.settings', threadId, patch: { allowAlways } })
      deps.onChange?.('thread', threadId)
    },
  }
}
