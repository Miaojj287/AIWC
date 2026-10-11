import type { AccountTarget } from './wechatKeys'
/**
 * Renderer ↔ main IPC contract. The preload exposes `window.aiwc: AiwcBridge`. Every channel is
 * typed here; handlers in electron/main/ipc/* implement InvokeMap, renderer hooks consume it.
 * Tests and the dev previews in dev/fixtures use src/platform/mockBridge.ts, which implements the same interface.
 */
import type { AppConfig, ConfigPatch, ModelSelection, ProviderConfig, ReasoningEffort } from './config'
import type { Event, Op, PendingAskEvent, ThreadOrigin, ThreadSettings } from './ops'
import type { HistoryItem } from './history'
import type { ThreadId } from './ids'
import type {
  ListMessagesQuery,
  ListSessionsQuery,
  MessageAnchor,
  SearchQuery,
  SearchHit,
  StatsQuery,
  StatsResult,
  SubstrateEvent,
  SyncStatus,
  WxAccount,
  WxContact,
  WxMedia,
  WxMessage,
  WxSession,
  ConnectionState,
  PageRequest,
} from './substrate'
import type { MemoryBudget, MemoryEntry, MemoryFile, PersonaNote, RelationshipProfile, CloneStatus } from './memory'
import type { AutoReplyRecord, AutoReplyRule, ReplyDraft } from './autoreply'
import type { JevPreview, JevTestResult } from './jev'
import type { GatewayEvent, AdapterState, ChannelKind } from './gateway'
import type { ModelTestResult } from './model'
import type { KeyAcquireScope, KeyAcquireStep } from './keyAcquire'
import type { InstalledPet, PetCatalogPage, PetCatalogQuery } from './pet'
import type { OfficeConnectSession, OfficePlatform, OfficePlatformStatus, OfficePushRecord } from './office'
import type { ScheduledTask, ScheduledTaskInput, TaskRun, TaskTemplate } from './tasks'
import type { TodoDay, TodoItem, TodoProgress, TodoScanResult, TodoStatus } from './todo'
import type { ThreadSearchHit } from './threadSearch'
import type { AutoSendHaltCode, ThreadExportOptions } from './privacy'
import {
  type ConversationEventMap,
  type ConversationInvokeMap,
  CONVERSATION_EVENT_CHANNELS,
  CONVERSATION_INVOKE_CHANNELS,
} from './ipcDomains/conversation'
import {
  type PrivacyEventMap,
  type PrivacyInvokeMap,
  PRIVACY_EVENT_CHANNELS,
  PRIVACY_INVOKE_CHANNELS,
} from './ipcDomains/privacy'
import {
  type SkillsEventMap,
  type SkillsInvokeMap,
  SKILLS_EVENT_CHANNELS,
  SKILLS_INVOKE_CHANNELS,
} from './ipcDomains/skills'
import {
  type AutomationEventMap,
  type AutomationInvokeMap,
  AUTOMATION_EVENT_CHANNELS,
  AUTOMATION_INVOKE_CHANNELS,
} from './ipcDomains/automation'
import {
  type ModelsEventMap,
  type ModelsInvokeMap,
  MODELS_EVENT_CHANNELS,
  MODELS_INVOKE_CHANNELS,
} from './ipcDomains/models'
import { type DataEventMap, type DataInvokeMap, DATA_EVENT_CHANNELS, DATA_INVOKE_CHANNELS } from './ipcDomains/data'
import {
  type MobileEventMap,
  type MobileInvokeMap,
  MOBILE_EVENT_CHANNELS,
  MOBILE_INVOKE_CHANNELS,
} from './ipcDomains/mobile'
import {
  type ExtensionsEventMap,
  type ExtensionsInvokeMap,
  EXTENSIONS_EVENT_CHANNELS,
  EXTENSIONS_INVOKE_CHANNELS,
} from './ipcDomains/extensions'

export interface ThreadSummary {
  threadId: ThreadId
  title: string
  origin: ThreadOrigin
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  pinned: boolean
  /** Moved out of the history list (已归档); still opens, searches leave it out. */
  archived?: boolean
  /** Workspace tab this thread references (session id / file path) for @ context. */
  contextRef?: { kind: 'session' | 'file' | 'contact'; id: string; label: string }
}

export interface SkillSummary {
  name: string
  description: string
  command: string /** e.g. '/周报' */
  source: 'builtin' | 'user' | 'agent'
}

export interface ToastPayload {
  id?: string
  kind: 'success' | 'info' | 'warning' | 'error' | 'progress'
  text: string
  action?: { label: string; command: string; payload?: unknown }
  sticky?: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up_to_date' | 'error'
  version?: string
  progress?: number
  error?: string
}

/** request → response pairs for ipcRenderer.invoke */
/** Core channels live here; newer domains are split into ./ipcDomains and merged in. */
export interface InvokeMap
  extends
    ConversationInvokeMap,
    PrivacyInvokeMap,
    SkillsInvokeMap,
    AutomationInvokeMap,
    ModelsInvokeMap,
    DataInvokeMap,
    MobileInvokeMap,
    ExtensionsInvokeMap {
  /** `zoom` = the macOS ⌥-click on the green button (maximise / restore); `fullscreen` toggles native full screen. */
  'app:windowControl': { req: { action: 'close' | 'minimize' | 'fullscreen' | 'zoom' }; res: void }
  /** `transparency`: this OS can show 透明效果 (macOS vibrancy / Windows 11 22H2+ acrylic). */
  'app:getInfo': {
    req: void
    res: {
      version: string
      platform: 'darwin' | 'win32' | 'linux'
      dataDir: string
      isPackaged: boolean
      transparency?: boolean
    }
  }
  'app:checkUpdate': { req: void; res: UpdateStatus }
  'app:exportLogs': { req: void; res: { path: string } }
  'app:openPath': { req: { path: string }; res: void }
  /**
   * Open a URL in the system browser / system settings. `app:openPath` is a filesystem opener behind
   * the path allow-list, so links and `x-apple.systempreferences:` deep links must come through here.
   */
  'app:openUrl': { req: { url: string }; res: void }
  'app:pickDirectory': { req: { title?: string; defaultPath?: string }; res: string | null }
  'app:setCloseBehaviorOnce': { req: { behavior: 'quit' | 'minimize'; remember: boolean }; res: void }

  'config:get': { req: void; res: AppConfig }
  'config:set': { req: ConfigPatch; res: AppConfig }
  'secret:set': { req: { ref: string; value: string }; res: void }
  'secret:has': { req: { ref: string }; res: boolean }
  'secret:reveal': { req: { ref: string }; res: string | null }
  'secret:delete': { req: { ref: string }; res: void }

  'ai:testModel': { req: { provider: ProviderConfig; modelId: string; apiKey?: string }; res: ModelTestResult }
  'ai:discoverModels': { req: { provider: ProviderConfig; apiKey?: string }; res: ProviderConfig['models'] }
  'ai:listRemoteModels': { req: { provider: ProviderConfig; apiKey?: string }; res: string[] }
  'ai:listLocalSttModels': {
    req: void
    res: Array<{
      id: string
      label: string
      sizeMb: number
      state: 'absent' | 'downloading' | 'ready'
      progress?: number
      isDefault: boolean
    }>
  }
  'ai:downloadSttModel': { req: { id: string }; res: void }
  'ai:cancelSttDownload': { req: { id: string }; res: void }
  'ai:deleteSttModel': { req: { id: string }; res: void }
  'ai:setDefaultSttModel': { req: { id: string }; res: void }

  'substrate:status': { req: void; res: { connection: ConnectionState; sync: SyncStatus; account?: WxAccount } }
  'substrate:detectWeChat': { req: void; res: { running: boolean; dbRoot?: string; version?: string } }
  'substrate:listAccounts': { req: { dbRoot?: string }; res: WxAccount[] }
  'substrate:verifyAccount': { req: { wxid: string; dbRoot: string }; res: { ok: boolean; error?: string } }
  'substrate:acquireKeys': {
    /** `scope: 'image'` = only the image keys (never touches WeChat's process); default 'all'. */
    req: { wxid: string; dbRoot: string; strategy?: 'auto' | 'memory_scan'; scope?: KeyAcquireScope }
    res: KeyAcquireStep[]
  }
  /** Abort the in-flight substrate:acquireKeys run (it resolves with its steps marked cancelled). */
  'substrate:cancelAcquireKeys': { req: void; res: void }
  'substrate:setManualKey': {
    req: { kind: 'db_key' | 'image_xor' | 'image_aes'; hex: string; target?: AccountTarget }
    res: { ok: boolean; error?: string }
  }
  /** Delete a saved key from the target account's secret store (default: the active account). */
  'substrate:clearKey': { req: { kind: 'db_key' | 'image_xor' | 'image_aes'; target?: AccountTarget }; res: void }
  'substrate:testConnection': { req: { wxid: string; dbRoot: string } | void; res: { ok: boolean; error?: string } }
  'substrate:connect': {
    req: void | AccountTarget
    res: { ok: boolean; error?: string }
  }
  'substrate:sync': { req: { full?: boolean }; res: SyncStatus }
  'substrate:listSessions': { req: ListSessionsQuery; res: { items: WxSession[]; total: number; hasMore: boolean } }
  'substrate:getSession': { req: { id: string }; res: WxSession | undefined }
  'substrate:listMessages': { req: ListMessagesQuery; res: { items: WxMessage[]; hasMore: boolean } }
  'substrate:getMessage': { req: { sessionId: string; messageId: string }; res: WxMessage | undefined }
  'substrate:getContext': { req: { anchor: MessageAnchor; radius: number }; res: WxMessage[] }
  'substrate:search': { req: SearchQuery; res: SearchHit[] }
  'substrate:listContacts': {
    req: { query?: string; kind?: WxContact['kind'] | 'all' } & PageRequest
    res: { items: WxContact[]; total: number }
  }
  'substrate:listGroupMembers': { req: { groupId: string } & PageRequest; res: { items: WxContact[]; total: number } }
  'substrate:stats': { req: StatsQuery; res: StatsResult }
  'substrate:resolveMedia': { req: { sessionId: string; messageId: string }; res: WxMedia | undefined }
  'substrate:transcribeVoice': { req: { sessionId: string; messageId: string; force?: boolean }; res: string }
  'substrate:setSessionFlags': {
    req: { sessionId: string; pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }
    res: void
  }
  'substrate:removeIndex': { req: { sessionId: string }; res: void }
  'substrate:rebuildIndex': { req: { sessionId: string }; res: void }
  'substrate:export': {
    req: {
      sessionId: string
      format: 'html' | 'markdown' | 'json' | 'excel'
      from?: number
      to?: number
      messageIds?: string[]
      /** Only messages from these senders (the chat's sender filter); absent or empty = everyone. */
      senderIds?: string[]
      outDir?: string
    }
    res: { path: string }
  }

  'agent:submit': { req: Op; res: void }
  /** Newest first, pinned on top; page with `offset` (a full page means there may be more). */
  'agent:listThreads': {
    req: { query?: string; limit?: number; offset?: number; channel?: ChannelKind }
    res: ThreadSummary[]
  }
  /** Full-text search in the desktop conversations: one hit per thread (threadSearch.ts). */
  'agent:searchThreads': { req: { query: string; limit?: number }; res: ThreadSearchHit[] }
  /** `running`: a turn is in progress, so a reloaded panel shows it as working instead of unanswered. */
  'agent:getThread': {
    req: { threadId: ThreadId }
    res: { summary: ThreadSummary; items: HistoryItem[]; running?: boolean; pendingAsks?: PendingAskEvent[] }
  }
  'agent:renameThread': { req: { threadId: ThreadId; title: string }; res: void }
  'agent:pinThread': { req: { threadId: ThreadId; pinned: boolean }; res: void }
  'agent:deleteThread': { req: { threadId: ThreadId }; res: void }
  'agent:exportThread': { req: { threadId: ThreadId; options?: ThreadExportOptions }; res: { path: string } }
  'agent:listSkills': { req: void; res: SkillSummary[] }
  'agent:listModels': {
    req: void
    res: Array<
      ModelSelection & {
        label: string
        providerLabel: string
        vendor?: string
        contextWindow: number
        local: boolean
        supportsTools: boolean
        reasoningEffort?: ReasoningEffort
        /** Accepts images (modelSupportsVision); the composer warns before sending one to a model that cannot. */
        supportsVision?: boolean
        /** Reasoning levels the model supports (modelCapabilities); empty = no reasoning control in the composer. */
        reasoningLevels?: ReasoningEffort[]
      }
    >
  }
  /** `batch` pages through the pool (换一批); any number wraps around. */

  'memory:read': { req: { file: MemoryFile }; res: string }
  'memory:write': { req: { file: MemoryFile; markdown: string }; res: void }
  'memory:entries': { req: { file: MemoryFile }; res: MemoryEntry[] }
  'memory:budget': { req: { file: MemoryFile }; res: MemoryBudget }
  'memory:clear': { req: { file: MemoryFile }; res: void }

  /** Every DM contact, cloned or not — the 克隆 column is a picker, so un-cloned contacts are included with `state: 'none'`. */
  'clone:list': {
    req: void
    res: Array<{
      contactId: string
      displayName: string
      status: CloneStatus
      messageCount?: number
      lastContactAt?: number
      avatarPath?: string
    }>
  }
  'clone:get': { req: { contactId: string }; res: RelationshipProfile | undefined }
  'clone:status': { req: { contactId: string }; res: CloneStatus }
  'clone:sampleMessages': { req: { contactId: string; limit?: number }; res: WxMessage[] }
  'clone:start': {
    req: {
      contactId: string
      range?: { from?: number; to?: number }
      model?: ModelSelection
      keepCorrections?: boolean
    }
    res: void
  }
  'clone:cancel': { req: { contactId: string }; res: void }
  'clone:delete': { req: { contactId: string }; res: { affectedRules: string[] } }
  'clone:updateProfile': {
    req: { contactId: string; patch: Partial<Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>> }
    res: RelationshipProfile
  }
  'clone:chat': { req: { contactId: string; threadId: ThreadId; text: string }; res: void }
  'clone:feedback': {
    req: {
      contactId: string
      messageItemId: string
      verdict: 'up' | 'down' | 'not_like'
      correction?: string
      saveAsSample?: boolean
    }
    res: void
  }
  /** Director's notes shown next to the test chat (corrections the clone must obey + past episodes). */
  'clone:notes': { req: { contactId: string }; res: PersonaNote[] }
  'clone:deleteNote': { req: { contactId: string; at: number }; res: void }
  /**
   * Distil the test-chat transcript into corrections + an episode summary. No-op (ok:false) when the
   * transcript has not grown enough since the last reflection.
   */
  'clone:reflect': {
    req: { contactId: string; threadId: ThreadId }
    res: { ok: boolean; corrections: number; episode?: string }
  }

  'autoreply:listRules': { req: void; res: AutoReplyRule[] }
  'autoreply:getRule': { req: { sessionId: string }; res: AutoReplyRule | undefined }
  'autoreply:saveRule': { req: AutoReplyRule; res: AutoReplyRule }
  'autoreply:setEnabled': { req: { sessionId: string; enabled: boolean }; res: void }
  'autoreply:deleteRule': { req: { sessionId: string }; res: void }
  'autoreply:listRecords': {
    req: { sessionId?: string; status?: AutoReplyRecord['status']; limit?: number }
    res: AutoReplyRecord[]
  }
  'autoreply:recall': { req: { recordId: string }; res: { ok: boolean; error?: string } }
  'autoreply:listDrafts': { req: void; res: ReplyDraft[] }
  'autoreply:resolveDraft': {
    req: { draftId: string; decision: 'approve' | 'reject' | 'edit'; text?: string }
    res: void
  }
  'autoreply:holdDraft': { req: { draftId: string }; res: void }
  'autoreply:retryDraft': { req: { draftId: string }; res: void }
  'autoreply:status': {
    req: void
    res: {
      halted?: string
      /** Why it halted; the UI branches on this (open the right System Settings pane), never on `halted`. */
      haltCode?: AutoSendHaltCode
      connection: string
      accountId?: string
      demo: boolean
      queued: number
      generating: Array<{ sessionId: string; name: string }>
    }
  }
  'autoreply:resume': { req: void; res: void }
  /** Reply to this chat's last message now, ignoring the quiet window and the already-tried latch. */
  'autoreply:triggerNow': { req: { sessionId: string }; res: { triggered: boolean; reason?: string } }

  /** Check the Jev key / endpoint (GET /v1/models); a typed key overrides the stored one without saving it. */
  'jev:test': { req: { apiKey?: string; baseUrl?: string; model?: string }; res: JevTestResult }
  /** Run an (unsaved) Jev rule against the chat's last message: the full distribution, nothing sent or recorded. */
  'jev:preview': { req: { sessionId: string; rule: AutoReplyRule }; res: JevPreview }

  'gateway:status': { req: void; res: Array<{ channel: ChannelKind; state: AdapterState; detail?: string }> }
  'gateway:connect': { req: { channel: ChannelKind }; res: void }
  'gateway:disconnect': { req: { channel: ChannelKind }; res: void }

  /** 每日待办: the checklist (open first), the per-day chat summaries, and the opt-in scanner. */
  'todo:list': { req: void; res: TodoItem[] }
  'todo:add': { req: { text: string }; res: TodoItem }
  'todo:update': { req: { id: string; done?: boolean; text?: string }; res: TodoItem }
  /** Resolves with the removed item so the renderer can offer 撤销 (→ todo:restore). */
  'todo:remove': { req: { id: string }; res: TodoItem | undefined }
  'todo:restore': { req: { item: TodoItem }; res: TodoItem }
  'todo:clearDone': { req: void; res: { removed: number } }
  /** Dates that have chat summaries, newest first. */
  'todo:days': { req: void; res: string[] }
  'todo:day': { req: { date: string }; res: TodoDay | undefined }
  'todo:status': { req: void; res: TodoStatus }
  /** Scan now (all picked chats, or `sourceIds` among them); progress on 'todo:progress'. */
  'todo:scan': { req: { sourceIds?: string[] } | undefined; res: TodoScanResult }
  'todo:cancelScan': { req: void; res: boolean }

  'file:read': { req: { path: string }; res: { content: string; mediaType: string } }
  'file:write': { req: { path: string; content: string }; res: void }
  'file:reveal': { req: { path: string }; res: void }
  /** Generated text (an Agent table as CSV) → a new file in the exports folder; the path is for 打开位置 (file:reveal). */
  'file:saveExport': { req: { name: string; ext: 'csv'; content: string }; res: { path: string } }

  /** Pets in <dataRoot>/pets (bundled pets first). */
  'pet:list': { req: void; res: InstalledPet[] }
  /** One page of the codex-pets.net community gallery. */
  'pet:catalog': { req: PetCatalogQuery; res: PetCatalogPage }
  /** 领养: download + validate + save; progress on 'pet:installStep'. */
  'pet:install': { req: { id: string }; res: InstalledPet }
  'pet:cancelInstall': { req: { id: string }; res: void }
  /** 导入: pick a pet zip (pet.json + spritesheet) with the system dialog; null when cancelled. */
  'pet:import': { req: void; res: InstalledPet | null }
  'pet:remove': { req: { id: string }; res: void }

  /** 飞书 / 钉钉 / 企业微信 through their official CLIs; cached for a minute unless `refresh`. */
  'office:status': { req: { refresh?: boolean } | undefined; res: OfficePlatformStatus[] }
  /** Start (or join) the browser-authorization flow; progress arrives on 'office:session'. */
  'office:connect': { req: { platform: OfficePlatform; reauthorize?: boolean }; res: OfficeConnectSession }
  'office:cancel': { req: { sessionId: string }; res: boolean }
  /** Re-open a waiting session's authorization link in the default browser. */
  'office:openLink': { req: { sessionId: string }; res: boolean }
  /** Active and recently finished sessions, for a renderer that (re)loads mid-flow. */
  'office:sessions': { req: void; res: OfficeConnectSession[] }
  'office:disconnect': { req: { platform: OfficePlatform }; res: OfficePlatformStatus }
  'office:pushes': { req: { limit?: number } | undefined; res: OfficePushRecord[] }

  /** 定时任务: prompts the agent runs unattended on a schedule (channel 'cron', grants = allow-list). */
  'task:list': { req: void; res: ScheduledTask[] }
  'task:get': { req: { id: string }; res: { task: ScheduledTask; runs: TaskRun[] } | undefined }
  /** Create (no id) or update; validated against ScheduledTaskInputSchema. */
  'task:save': { req: ScheduledTaskInput; res: ScheduledTask }
  'task:delete': { req: { id: string }; res: void }
  'task:setEnabled': { req: { id: string; enabled: boolean }; res: ScheduledTask }
  /** Start a run now; progress and the result arrive on 'task:run'. */
  'task:runNow': { req: { id: string }; res: TaskRun }
  'task:cancel': { req: { id: string }; res: boolean }
  'task:runs': { req: { id?: string; limit?: number }; res: TaskRun[] }
  'task:templates': { req: void; res: TaskTemplate[] }
}

export type InvokeChannel = keyof InvokeMap
export type InvokeReq<K extends InvokeChannel> = InvokeMap[K]['req']
export type InvokeRes<K extends InvokeChannel> = InvokeMap[K]['res']

/** main → renderer push events */
export interface EventMap
  extends
    ConversationEventMap,
    PrivacyEventMap,
    SkillsEventMap,
    AutomationEventMap,
    ModelsEventMap,
    DataEventMap,
    MobileEventMap,
    ExtensionsEventMap {
  'agent:event': Event
  'substrate:event': SubstrateEvent
  /** progress of substrate:acquireKeys (one push per step transition) */
  'substrate:keyStep': KeyAcquireStep
  'gateway:event': GatewayEvent
  'memory:changed': { file: MemoryFile; source: MemoryEntry['source'] }
  'clone:status': { contactId: string; status: CloneStatus }
  'autoreply:rulesChanged': { sessionId: string }
  'autoreply:draft': ReplyDraft
  'autoreply:record': AutoReplyRecord
  'todo:progress': TodoProgress
  /** Items, summaries or scan status changed (a scheduled scan finished, another window edited the list). */
  'todo:changed': { scope: 'items' | 'status' | 'all' }
  'app:toast': ToastPayload
  'app:update': UpdateStatus
  'app:closeRequested': { reason: 'window_close' }
  'app:command': { command: string; payload?: unknown }
  /** Native window state the renderer lays itself out around (custom macOS controls hide in full screen). */
  'app:windowState': { fullscreen: boolean; maximized: boolean }
  /** The pets folder changed (install / import / remove). */
  'pet:changed': { reason: 'installed' | 'imported' | 'removed'; id: string }
  /** Step transitions of a running pet:install (download → verify → save). */
  'pet:installStep': {
    id: string
    step: 'download' | 'verify' | 'save'
    status: 'doing' | 'done' | 'failed'
    detail?: string
  }
  /** Every change of an office connect session (steps, link + QR, final status). */
  'office:session': OfficeConnectSession
  /** A task was created / updated / deleted / toggled; the renderer re-lists. */
  'task:changed': { reason: 'saved' | 'deleted' | 'toggled' | 'scheduled'; id: string }
  /** Every state change of a task run (started → done / failed / cancelled). */
  'task:run': TaskRun
}

export type EventChannel = keyof EventMap

export interface AiwcBridge {
  invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>>
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  /** 'electron' in the app; 'web' only for the mock bridge used by tests and dev previews. */
  readonly runtime: 'electron' | 'web'
  readonly platform: 'darwin' | 'win32' | 'linux'
}

export const INVOKE_CHANNELS = [
  'app:windowControl',
  'app:getInfo',
  'app:checkUpdate',
  'app:exportLogs',
  'app:openPath',
  'app:openUrl',
  'app:pickDirectory',
  'app:setCloseBehaviorOnce',
  'config:get',
  'config:set',
  'secret:set',
  'secret:has',
  'secret:reveal',
  'secret:delete',
  'ai:testModel',
  'ai:listRemoteModels',
  'ai:discoverModels',
  'ai:listLocalSttModels',
  'ai:downloadSttModel',
  'ai:cancelSttDownload',
  'ai:deleteSttModel',
  'ai:setDefaultSttModel',
  'substrate:status',
  'substrate:detectWeChat',
  'substrate:listAccounts',
  'substrate:verifyAccount',
  'substrate:acquireKeys',
  'substrate:cancelAcquireKeys',
  'substrate:setManualKey',
  'substrate:clearKey',
  'substrate:testConnection',
  'substrate:connect',
  'substrate:sync',
  'substrate:listSessions',
  'substrate:getSession',
  'substrate:listMessages',
  'substrate:getMessage',
  'substrate:getContext',
  'substrate:search',
  'substrate:listContacts',
  'substrate:listGroupMembers',
  'substrate:stats',
  'substrate:resolveMedia',
  'substrate:transcribeVoice',
  'substrate:setSessionFlags',
  'substrate:removeIndex',
  'substrate:rebuildIndex',
  'substrate:export',
  'agent:submit',
  'agent:listThreads',
  'agent:searchThreads',
  'agent:getThread',
  'agent:renameThread',
  'agent:pinThread',
  'agent:deleteThread',
  'agent:exportThread',
  'agent:listSkills',
  'agent:listModels',
  'memory:read',
  'memory:write',
  'memory:entries',
  'memory:budget',
  'memory:clear',
  'clone:list',
  'clone:get',
  'clone:status',
  'clone:sampleMessages',
  'clone:start',
  'clone:cancel',
  'clone:delete',
  'clone:updateProfile',
  'clone:chat',
  'clone:feedback',
  'clone:notes',
  'clone:deleteNote',
  'clone:reflect',
  'autoreply:listRules',
  'autoreply:getRule',
  'autoreply:saveRule',
  'autoreply:setEnabled',
  'autoreply:deleteRule',
  'autoreply:listRecords',
  'autoreply:recall',
  'autoreply:listDrafts',
  'autoreply:resolveDraft',
  'autoreply:holdDraft',
  'autoreply:retryDraft',
  'autoreply:status',
  'autoreply:resume',
  'autoreply:triggerNow',
  'jev:test',
  'jev:preview',
  'gateway:status',
  'gateway:connect',
  'gateway:disconnect',
  'todo:list',
  'todo:add',
  'todo:update',
  'todo:remove',
  'todo:restore',
  'todo:clearDone',
  'todo:days',
  'todo:day',
  'todo:status',
  'todo:scan',
  'todo:cancelScan',
  'file:read',
  'file:write',
  'file:reveal',
  'file:saveExport',
  'pet:list',
  'pet:catalog',
  'pet:install',
  'pet:cancelInstall',
  'pet:import',
  'pet:remove',
  'office:status',
  'office:connect',
  'office:cancel',
  'office:openLink',
  'office:sessions',
  'office:disconnect',
  'office:pushes',
  'task:list',
  'task:get',
  'task:save',
  'task:delete',
  'task:setEnabled',
  'task:runNow',
  'task:cancel',
  'task:runs',
  'task:templates',
  ...CONVERSATION_INVOKE_CHANNELS,
  ...PRIVACY_INVOKE_CHANNELS,
  ...SKILLS_INVOKE_CHANNELS,
  ...AUTOMATION_INVOKE_CHANNELS,
  ...MODELS_INVOKE_CHANNELS,
  ...DATA_INVOKE_CHANNELS,
  ...MOBILE_INVOKE_CHANNELS,
  ...EXTENSIONS_INVOKE_CHANNELS,
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'agent:event',
  'substrate:event',
  'substrate:keyStep',
  'gateway:event',
  'memory:changed',
  'clone:status',
  'autoreply:draft',
  'autoreply:record',
  'autoreply:rulesChanged',
  'todo:progress',
  'todo:changed',
  'app:toast',
  'app:update',
  'app:closeRequested',
  'app:command',
  'app:windowState',
  'pet:changed',
  'pet:installStep',
  'office:session',
  'task:changed',
  'task:run',
  ...CONVERSATION_EVENT_CHANNELS,
  ...PRIVACY_EVENT_CHANNELS,
  ...SKILLS_EVENT_CHANNELS,
  ...AUTOMATION_EVENT_CHANNELS,
  ...MODELS_EVENT_CHANNELS,
  ...DATA_EVENT_CHANNELS,
  ...MOBILE_EVENT_CHANNELS,
  ...EXTENSIONS_EVENT_CHANNELS,
] as const satisfies readonly EventChannel[]

/**
 * `satisfies` only proves every listed name is a real channel — it says nothing about the ones you
 * forgot to list. A channel that exists in IpcMap but not in the array type-checks everywhere and
 * then dies at runtime with "unknown ipc channel", because the preload allow-list is built from the
 * array. These two aliases fail the build instead, naming the channel you missed.
 */
type AssertNoneMissing<T extends never> = T
type _InvokeChannelsComplete = AssertNoneMissing<Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>>
type _EventChannelsComplete = AssertNoneMissing<Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>>
