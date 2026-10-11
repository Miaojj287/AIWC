/**
 * Privacy & control wiring for the composition root:
 *  - 总是允许 grants (services/grants.ts): global ones persisted on approval, both kinds listed and revoked in 设置.
 *  - Auto-send OS permissions (services/autoSendPermissions.ts), fed by what real sends show.
 *  - The Agent change journal (services/changes/*): a kernel hook records what each turn changed; 撤销 reverses it.
 */
import { join } from 'node:path'
import type { AppConfig, ConfigPatch, GatewayEvent, MemoryStore, ThreadId, TurnId } from '@aiwc/protocol'
import type { HookRunner, Kernel } from '@aiwc/kernel'
import type { Broadcast } from './contracts'
import type { Logger } from './log'
import {
  createAutoSendPermissions,
  permissionMemoryFile,
  type AutoSendPermissionService,
} from './services/autoSendPermissions'
import { createChangeJournal, type ChangeJournal } from './services/changes/journal'
import { createChangeRecorder } from './services/changes/recorder'
import { createCaptureCache } from './services/changes/workspaceCapture'
import { createGrantService, type GrantService } from './services/grants'

/** OS facilities the composition root cannot reach without importing electron (index.ts supplies them). */
export interface PrivacyHost {
  isAccessibilityTrusted(): boolean
  /** Identifies this exact build (version + executable); changes when the app is updated. */
  fingerprint(): string
  /** Move to the OS trash (recoverable). */
  trash(path: string): Promise<void>
}

export interface PrivacyServices {
  grants: GrantService
  permissions: AutoSendPermissionService
  changes: ChangeJournal
  dispose(): void
}

export interface PrivacyDeps {
  changesDir: string
  workspaceDir: string
  gatewayStateDir: string
  config: { get(): AppConfig; set(patch: ConfigPatch): AppConfig }
  kernel: Pick<Kernel, 'listThreads' | 'submit' | 'events'>
  memory: MemoryStore
  skills: { writableDir(): { path: string } | undefined; refresh(): Promise<unknown> }
  hooks: HookRunner
  gatewayEvents: { on(listener: (e: GatewayEvent) => void): () => void }
  chatName: (chatId: string) => Promise<string | undefined>
  broadcast: Broadcast
  host?: PrivacyHost
  platform?: NodeJS.Platform
  logger: Logger
}

const NO_HOST: PrivacyHost = {
  isAccessibilityTrusted: () => false,
  fingerprint: () => 'unknown',
  trash: async () => {
    throw new Error('trash is not available in this host')
  },
}

export function composePrivacy(deps: PrivacyDeps): PrivacyServices {
  const host = deps.host ?? NO_HOST
  const log = deps.logger.child('privacy')
  const unsubscribers: Array<() => void> = []

  const grants = createGrantService({
    config: deps.config,
    kernel: deps.kernel,
    onChange: (scope, threadId) =>
      deps.broadcast('privacy:grantsChanged', { scope, ...(threadId ? { threadId } : {}) }),
  })
  // A thread grant is saved by the kernel itself (ThreadSettings); tell the permission-rules page all the same.
  unsubscribers.push(
    deps.kernel.events.on((e) => {
      if (e.type === 'approval.resolved' && e.decision === 'allow_always' && e.scope !== 'global')
        deps.broadcast('privacy:grantsChanged', { scope: 'thread', threadId: e.threadId })
    }),
  )

  const permissions = createAutoSendPermissions({
    platform: deps.platform ?? process.platform,
    isAccessibilityTrusted: () => host.isAccessibilityTrusted(),
    fingerprint: () => host.fingerprint(),
    ...permissionMemoryFile(join(deps.gatewayStateDir, 'os-permissions.json')),
  })
  unsubscribers.push(
    deps.gatewayEvents.on((e) => {
      if (e.type === 'outbound' && e.req.to.channel === 'wechat-ui' && e.result.verified) permissions.noteVerifiedSend()
      if (e.type === 'autoreply.halted') permissions.noteHalt(e.code)
    }),
  )

  const changes = createChangeJournal({
    dir: deps.changesDir,
    undo: {
      roots: { workspace: deps.workspaceDir, skills: () => deps.skills.writableDir()?.path },
      trash: (path) => host.trash(path),
      memory: deps.memory,
      refreshSkills: async () => {
        await deps.skills.refresh()
      },
    },
    logger: (level, msg, meta) => log[level](msg, meta),
  })
  const notifyChanges = (threadId: ThreadId, turnId?: TurnId) =>
    deps.broadcast('privacy:changes', { threadId, ...(turnId ? { turnId } : {}) })
  unsubscribers.push(
    deps.hooks.add(
      createChangeRecorder({
        journal: changes,
        workspaceDir: deps.workspaceDir,
        skillsDir: () => deps.skills.writableDir()?.path,
        cache: createCaptureCache(),
        memoryEntries: (file) => deps.memory.entries(file),
        chatName: deps.chatName,
        onRecorded: notifyChanges,
      }),
    ),
  )

  return {
    grants,
    permissions,
    changes: {
      ...changes,
      async undo(id) {
        const result = await changes.undo(id)
        const change = changes.find(id)
        if (result.ok && change) notifyChanges(change.threadId, change.turnId)
        return result
      },
    },
    dispose() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
    },
  }
}
