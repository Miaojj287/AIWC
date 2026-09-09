/**
 * Types shared across the main process: the composed AppContext handed to the IPC layer, plus the
 * small adapters the root puts around sibling packages (clone start options, substrate host façade).
 */
import type { CloneStatus, DiaryPipeline, DiaryStore, EventChannel, EventMap, InvokeRes, MemoryStore, ModelClient, ModelSelection, ToastPayload } from '@aiwc/protocol'
import type { Kernel, ModelResolver, SkillIndex } from '@aiwc/kernel'
import type { RelationshipStoreExt } from '@aiwc/memory'
import type { AutoReplyRecordStore, AutoReplyService, Gateway, UiInjectSender } from '@aiwc/gateway'
import type { SubstrateClient } from '@aiwc/substrate'
import type { SubstrateHostInit } from '../hosts/substrateHost'
import type { AppPaths } from './paths'
import type { Logger } from './log'
import type { ConfigService } from './config/configService'
import type { SecretStore } from './config/secretStore'
import type { AllowList } from './security/pathAllowList'

export type { SubstrateClient, SubstrateHostInit }

/** main → renderer push, to every open window. */
export type Broadcast = <K extends EventChannel>(channel: K, payload: EventMap[K]) => void

export type SubstrateMode = SubstrateHostInit['mode']

/** Stable façade over the (restartable) utility process. */
export interface SubstrateHost extends SubstrateClient {
  mode(): SubstrateMode
  /** Fork the host and, when account config is complete, open the account. */
  start(): Promise<void>
  /** Re-fork with the current config (after onboarding / key change) and open. */
  reconnect(): Promise<{ ok: boolean; error?: string }>
  shutdown(): Promise<void>
}

/** What the IPC layer may pass to clone.start (@aiwc/memory CloneBuildOptions + a model choice). */
export interface CloneStartOptions {
  range?: { from?: number; to?: number }
  /** Model for this build; the root routes it through the builder's model getter. */
  model?: ModelSelection
  keepCorrections?: boolean
  force?: boolean
  displayName?: string
  role?: 'contact' | 'self'
}

export interface CloneBuilderLike {
  start(contactId: string, opts?: CloneStartOptions): Promise<void>
  cancel(contactId: string): void
  onStatus(cb: (e: { contactId: string; status: CloneStatus }) => void): () => void
}

export interface ModelResolverLike extends ModelResolver {
  list(): InvokeRes<'agent:listModels'>
  clientFor(selection: ModelSelection): ModelClient
}

// ---- composed application ---------------------------------------------------------------------

export interface AppContext {
  paths: AppPaths
  logger: Logger
  config: ConfigService
  secrets: SecretStore
  kernel: Kernel
  skills: SkillIndex
  models: ModelResolverLike
  substrate: SubstrateHost
  memory: MemoryStore
  /** The concrete store: the clone IPC needs pairs / notes / reflection state, not just the protocol subset. */
  relationships: RelationshipStoreExt
  diaries: DiaryStore
  diary: DiaryPipeline & { start(): void; stop(): void }
  gateway: Gateway
  autoReplyMonitor: { refresh(): Promise<void>; triggerNow(sessionId: string): Promise<{ triggered: boolean; reason?: string }> }
  autoReply: AutoReplyService
  /** records.db: rules + records + drafts (owned by @aiwc/gateway). */
  records: AutoReplyRecordStore
  /** Keyboard-injection sender for the 'wechat-ui' channel (DB read-back verified, halts on failure). */
  uiSender: UiInjectSender
  clone: CloneBuilderLike
  allowList: AllowList
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  shutdown(): Promise<void>
}
