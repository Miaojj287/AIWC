/**
 * 我的微信 wiring for the composition root: the owner's iLink bot (login kept in the encrypted secret store), the
 * owner channel (the only outbound path: owner-only, origin-guarded, audited), task-result pushes and phone
 * remote control. Pushes the whole status on 'mobile:changed' whenever anything the settings page shows changes.
 *
 * Why task pushes and remote replies need no per-message approval (CLAUDE.md §5): they are not Agent tool calls.
 * The recipient is fixed to the account that scanned the QR code — nothing the model writes can address anyone
 * else — and the user switched each one on explicitly (per task / the remote toggle). They are the phone
 * equivalent of a desktop notification. Agent tool calls on the phone thread still go through the approval
 * matrix of its permission mode (Ask by default, never Autopilot), answered on the phone or the computer.
 */
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { MobileRemoteSettings, MobileSendRecord, MobileStatus, ScheduledTask, TaskRun } from '@aiwc/protocol'
import {
  createIlinkAdapter,
  createOwnerChannel,
  createRemoteControl,
  maskId,
  type Gateway,
  type IlinkAdapter,
} from '@aiwc/gateway'
import type { Kernel } from '@aiwc/kernel'
import type { SecretStore } from './config/secretStore'
import type { Broadcast } from './contracts'
import { t } from './i18n'
import { localizeText } from './localizePayloads'
import { formatRemoteNotice, formatTaskPush } from './mobileText'
import { createMobileAudit, createMobileStateStore, createSecretIlinkSessionStore } from './services/mobileStore'

type PkgLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

/** The plaintext login file older builds wrote next to the iLink media cache. */
const LEGACY_SESSION_FILE = 'ilink-session.json'

export interface ComposeMobileDeps {
  /** `<dataRoot>/mobile`: state.json + sends.jsonl. */
  dir: string
  /** The iLink adapter's state dir (inbound media). */
  gatewayStateDir: string
  gateway: Gateway
  kernel: Pick<Kernel, 'submit' | 'events' | 'getThread'>
  secrets: SecretStore
  broadcast: Broadcast
  logger: PkgLogger
  /** Tests inject a scripted adapter. */
  adapter?: IlinkAdapter
}

export interface MobileService {
  status(): MobileStatus
  /** Start the QR login (or reconnect with the stored login) in the background. */
  connect(): MobileStatus
  cancelLogin(): MobileStatus
  disconnect(): Promise<MobileStatus>
  setRemote(next: MobileRemoteSettings): MobileStatus
  test(): Promise<MobileSendRecord>
  sends(limit: number): MobileSendRecord[]
  /** 完成后推送到我的微信: called for every finished run; does nothing unless the task asked for it. */
  pushTaskRun(run: TaskRun, task: Pick<ScheduledTask, 'id' | 'name' | 'pushToPhone'>): Promise<void>
  /** Reconnect a stored login at startup. */
  start(): void
  dispose(): void
}

export function composeMobile(deps: ComposeMobileDeps): MobileService {
  const log = deps.logger
  const legacy = join(deps.gatewayStateDir, LEGACY_SESSION_FILE)
  try {
    if (existsSync(legacy)) unlinkSync(legacy)
  } catch (err) {
    log('warn', 'mobile: could not remove the legacy plaintext login', err)
  }

  const state = createMobileStateStore(deps.dir, log)
  const audit = createMobileAudit(deps.dir, log)
  const sessionStore = createSecretIlinkSessionStore(deps.secrets, log)
  const adapter = deps.adapter ?? createIlinkAdapter({ stateDir: deps.gatewayStateDir, sessionStore, logger: log })
  deps.gateway.registerAdapter(adapter)

  let qrDataUrl: string | undefined
  let detail: string | undefined
  const ownerId = (): string | undefined => adapter.session?.userId?.trim() || undefined

  const status = (): MobileStatus => {
    const session = adapter.session
    const snapshot = remote.snapshot()
    const last = audit.recent(1)[0]
    const connecting = adapter.state === 'connecting'
    return {
      state: adapter.state,
      ...(connecting && qrDataUrl && adapter.loginPhase === 'qr' ? { qrDataUrl } : {}),
      scanned: connecting && adapter.loginPhase === 'scanned',
      ...(detail ? { detail } : {}),
      ...(session?.userId ? { owner: maskId(session.userId) } : {}),
      ownerUnknown: Boolean(session && !session.userId),
      persisted: sessionStore.persisted,
      remote: {
        ...state.remote(),
        ...(snapshot.threadId ? { threadId: snapshot.threadId } : {}),
        running: snapshot.running,
        pendingApprovals: snapshot.pendingApprovals,
      },
      ...(last ? { lastSend: last } : {}),
    }
  }
  const publish = (): void => deps.broadcast('mobile:changed', status())

  const channel = createOwnerChannel({
    outbound: deps.gateway.outbound,
    ownerId,
    audit: (record) => {
      audit.append(record)
      publish()
    },
  })

  const remote = createRemoteControl({
    kernel: deps.kernel,
    channel,
    ownerId,
    settings: () => state.remote(),
    threadTitle: () => t('mobile.threadTitle'),
    loadThreadId: () => state.threadId(),
    saveThreadId: (id) => state.setThreadId(id),
    format: formatRemoteNotice,
    onChange: publish,
    logger: log,
  })

  const unsubscribers: Array<() => void> = [
    adapter.onStateChange((_next, nextDetail) => {
      detail = nextDetail ? localizeText(nextDetail) : undefined
      if (adapter.state !== 'connecting') qrDataUrl = undefined
      publish()
    }),
    adapter.onQr((dataUrl) => {
      qrDataUrl = dataUrl
      publish()
    }),
    deps.gateway.onInbound((event) => {
      if (event.source.channel !== 'wechat-ilink') return
      // Not awaited: the remote service queues owner messages itself, and the gateway's inbound chain must not
      // wait on phone replies going out.
      void remote.handle(event).catch((err) => log('error', 'mobile: owner message not handled', err))
    }),
  ]

  const connect = (): void => {
    if (adapter.state === 'connected' || adapter.state === 'connecting') return
    detail = undefined
    void adapter.connect().catch((err) => {
      log('warn', 'mobile: connect failed', err)
      publish()
    })
  }

  const errorText = (code: string | undefined): string | undefined => {
    switch (code) {
      case undefined:
        return undefined
      case 'no_owner':
        return t('mobile.errors.noOwner')
      case 'empty':
        return t('mobile.errors.empty')
      default:
        return localizeText(code)
    }
  }
  const localized = (record: MobileSendRecord): MobileSendRecord =>
    record.error ? { ...record, error: errorText(record.error) } : record

  return {
    status: () => {
      const s = status()
      return s.lastSend ? { ...s, lastSend: localized(s.lastSend) } : s
    },
    connect() {
      connect()
      return status()
    },
    cancelLogin() {
      adapter.cancelLogin()
      qrDataUrl = undefined
      publish()
      return status()
    },
    async disconnect() {
      await adapter.logout()
      qrDataUrl = undefined
      detail = undefined
      publish()
      return status()
    },
    setRemote(next) {
      state.setRemote(next)
      publish()
      return status()
    },
    async test() {
      await channel.send(t('mobile.phone.test'), { kind: 'notice' })
      const last = audit.recent(1)[0]
      if (!last) throw new Error(t('mobile.errors.noOwner'))
      return localized(last)
    },
    sends: (limit) => audit.recent(limit).map(localized),
    async pushTaskRun(run, task) {
      if (!task.pushToPhone) return
      const text = formatTaskPush(run, task.name)
      if (!text) return
      const result = await channel.send(text, { kind: 'task', taskId: task.id, threadId: run.threadId })
      if (!result.ok) log('warn', 'mobile: task result not pushed', { taskId: task.id, error: result.error })
    },
    start() {
      if (adapter.session) connect()
    },
    dispose() {
      for (const off of unsubscribers) off()
      remote.dispose()
    },
  }
}
