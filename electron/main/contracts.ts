/**
 * Types shared across the main process: the composed AppContext handed to the IPC layer, plus the
 * small adapters the root puts around sibling packages (clone start options, substrate host façade).
 */
import type {
  CloneStatus,
  EventChannel,
  EventMap,
  InvokeRes,
  MemoryStore,
  ModelClient,
  ModelSelection,
  ModelUsageFeature,
  ToastPayload,
} from '@aiwc/protocol'
import type { Kernel, ModelResolver, SkillIndexExt } from '@aiwc/kernel'
import type { RelationshipStoreExt } from '@aiwc/memory'
import type { AutoReplyRecordStore, AutoReplyService, Gateway, UiInjectSender } from '@aiwc/gateway'
import type { SubstrateClient } from '@aiwc/substrate'
import type { OfficeService } from '@aiwc/office'
import type { SubstrateHostInit } from '../hosts/substrateHost'
import type { AppPaths } from './paths'
import type { Logger } from './log'
import type { ConfigService } from './config/configService'
import type { SecretStore } from './config/secretStore'
import type { ExtensionsService } from './extensions/service'
import type { AllowList } from './security/pathAllowList'
import type { JevClient } from './services/jevClient'
import type { PetService } from './services/petService'
import type { TaskScheduler } from './services/taskScheduler'
import type { MobileService } from './composeMobile'
import type { TodoService } from './composeTodo'
import type { MemoryReviewService } from './composeMemory'
import type { ModelOps } from './composeModels'
import type { PrivacyServices } from './composePrivacy'

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
  /** Same resolver, with calls tagged as `feature` in the usage log (设置 › 用量与记录). */
  forFeature(feature: ModelUsageFeature): ModelResolver
}

// ---- composed application ---------------------------------------------------------------------

export interface AppContext {
  /** Confirm this account for the session before starting background automation. */
  activate(): void
  paths: AppPaths
  logger: Logger
  config: ConfigService
  secrets: SecretStore
  kernel: Kernel
  /** Skill folders: the model's index, plus the 设置 › 技能 list / viewer / delete. */
  skills: SkillIndexExt
  models: ModelResolverLike
  /** Proxy transport, usage roll-ups and the call log (composeModels.ts). */
  modelOps: ModelOps
  substrate: SubstrateHost
  memory: MemoryStore
  /** 设置 › 记忆 › 待确认: proposals awaiting the user, and the idle-conversation extraction that adds them. */
  memoryReview: MemoryReviewService
  /** The concrete store: the clone IPC needs pairs / notes / reflection state, not just the protocol subset. */
  relationships: RelationshipStoreExt
  /** 每日待办: the checklist store and the opt-in scanner of the picked group chats. */
  todo: TodoService
  gateway: Gateway
  autoReplyMonitor: {
    refresh(): Promise<void>
    triggerNow(sessionId: string): Promise<{ triggered: boolean; reason?: string }>
  }
  autoReply: AutoReplyService
  /** records.db: rules + records + drafts (owned by @aiwc/gateway). */
  records: AutoReplyRecordStore
  /** TypeSafe's Jev decision model (自动回复的 Jev（beta）回复方式): key test and the rule dry run. */
  jev: JevClient
  /** Keyboard-injection sender for the 'wechat-ui' channel (DB read-back verified, halts on failure). */
  uiSender: UiInjectSender
  clone: CloneBuilderLike
  /** AI 宠物: pets folder, bundled pets, codex-pets.net catalog. */
  pets: PetService
  /** 飞书 / 钉钉 / 企业微信 through their official CLIs. */
  office: OfficeService
  /** 定时任务: prompts run unattended on a schedule. */
  tasks: TaskScheduler
  /** 设置 › 扩展: MCP servers and user hooks (composeExtensions.ts). */
  extensions: ExtensionsService
  /** 我的微信: the owner's own iLink bot — task pushes and phone remote control. */
  mobile: MobileService
  privacy: PrivacyServices
  allowList: AllowList
  /** paths.ts protectedDataPaths for the current custom cache dir: renderer `file:write` never lands there. */
  protectedPaths(): string[]
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  shutdown(): Promise<void>
}
