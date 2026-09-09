/**
 * Renderer ↔ main IPC contract. The preload exposes `window.aiwc: AiwcBridge`. Every channel is
 * typed here; handlers in electron/main/ipc/* implement InvokeMap, renderer hooks consume it.
 * In web-only mode (`npm run dev:web`) src/platform/mockBridge.ts implements the same interface.
 */
import type { AppConfig, ConfigPatch, ModelSelection, ProviderConfig, ReasoningEffort } from './config'
import type { Event, Op, ThreadOrigin, ThreadSettings } from './ops'
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
import type { MemoryBudget, MemoryEntry, MemoryFile, PersonaNote, RelationshipProfile, CloneStatus, DiaryEntry } from './memory'
import type { AutoReplyRecord, AutoReplyRule, ReplyDraft } from './autoreply'
import type { GatewayEvent, AdapterState, ChannelKind } from './gateway'
import type { ModelTestResult } from './model'

export interface ThreadSummary {
  threadId: ThreadId
  title: string
  origin: ThreadOrigin
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  pinned: boolean
  /** Workspace tab this thread references (session id / file path) for @ context. */
  contextRef?: { kind: 'session' | 'file' | 'contact'; id: string; label: string }
}

export interface SkillSummary {
  name: string
  description: string
  command: string /** e.g. '/周报' */
  source: 'builtin' | 'user' | 'agent'
}

export interface KeyAcquireStep {
  id: 'db_key' | 'image_xor' | 'image_aes' | 'verify'
  label: string
  status: 'todo' | 'doing' | 'done' | 'failed'
  detail?: string
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
export interface InvokeMap {
  'app:getInfo': { req: void; res: { version: string; platform: 'darwin' | 'win32' | 'linux'; dataDir: string; isPackaged: boolean } }
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
  'ai:listLocalSttModels': { req: void; res: Array<{ id: string; label: string; sizeMb: number; state: 'absent' | 'downloading' | 'ready'; progress?: number; isDefault: boolean }> }
  'ai:downloadSttModel': { req: { id: string }; res: void }
  'ai:cancelSttDownload': { req: { id: string }; res: void }
  'ai:deleteSttModel': { req: { id: string }; res: void }
  'ai:setDefaultSttModel': { req: { id: string }; res: void }

  'substrate:status': { req: void; res: { connection: ConnectionState; sync: SyncStatus; account?: WxAccount } }
  'substrate:detectWeChat': { req: void; res: { running: boolean; dbRoot?: string; version?: string } }
  'substrate:listAccounts': { req: { dbRoot?: string }; res: WxAccount[] }
  'substrate:verifyAccount': { req: { wxid: string; dbRoot: string }; res: { ok: boolean; error?: string } }
  'substrate:acquireKeys': { req: { wxid: string; dbRoot: string; strategy?: 'auto' | 'memory_scan' }; res: KeyAcquireStep[] }
  'substrate:setManualKey': { req: { kind: 'db_key' | 'image_xor' | 'image_aes'; hex: string }; res: { ok: boolean; error?: string } }
  'substrate:testConnection': { req: { wxid: string; dbRoot: string } | void; res: { ok: boolean; error?: string } }
  'substrate:connect': { req: void | { wxid: string; dbRoot: string }; res: { ok: boolean; error?: string } }
  'substrate:sync': { req: { full?: boolean }; res: SyncStatus }
  'substrate:listSessions': { req: ListSessionsQuery; res: { items: WxSession[]; total: number; hasMore: boolean } }
  'substrate:getSession': { req: { id: string }; res: WxSession | undefined }
  'substrate:listMessages': { req: ListMessagesQuery; res: { items: WxMessage[]; hasMore: boolean } }
  'substrate:getContext': { req: { anchor: MessageAnchor; radius: number }; res: WxMessage[] }
  'substrate:search': { req: SearchQuery; res: SearchHit[] }
  'substrate:listContacts': { req: { query?: string; kind?: WxContact['kind'] | 'all' } & PageRequest; res: { items: WxContact[]; total: number } }
  'substrate:listGroupMembers': { req: { groupId: string } & PageRequest; res: { items: WxContact[]; total: number } }
  'substrate:stats': { req: StatsQuery; res: StatsResult }
  'substrate:resolveMedia': { req: { sessionId: string; messageId: string }; res: WxMedia | undefined }
  'substrate:transcribeVoice': { req: { sessionId: string; messageId: string; force?: boolean }; res: string }
  'substrate:setSessionFlags': { req: { sessionId: string; pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }; res: void }
  'substrate:removeIndex': { req: { sessionId: string }; res: void }
  'substrate:rebuildIndex': { req: { sessionId: string }; res: void }
  'substrate:export': { req: { sessionId: string; format: 'html' | 'markdown' | 'json' | 'excel'; from?: number; to?: number; messageIds?: string[]; outDir?: string }; res: { path: string } }

  'agent:submit': { req: Op; res: void }
  'agent:listThreads': { req: { query?: string; limit?: number; channel?: ChannelKind }; res: ThreadSummary[] }
  'agent:getThread': { req: { threadId: ThreadId }; res: { summary: ThreadSummary; items: HistoryItem[] } }
  'agent:renameThread': { req: { threadId: ThreadId; title: string }; res: void }
  'agent:pinThread': { req: { threadId: ThreadId; pinned: boolean }; res: void }
  'agent:deleteThread': { req: { threadId: ThreadId }; res: void }
  'agent:exportThread': { req: { threadId: ThreadId }; res: { path: string } }
  'agent:listSkills': { req: void; res: SkillSummary[] }
  'agent:listModels': { req: void; res: Array<ModelSelection & { label: string; providerLabel: string; vendor?: string; contextWindow: number; local: boolean; supportsTools: boolean; reasoningEffort?: ReasoningEffort }> }
  'agent:suggestPrompts': { req: { contextRef?: ThreadSummary['contextRef'] }; res: string[] }

  'memory:read': { req: { file: MemoryFile }; res: string }
  'memory:write': { req: { file: MemoryFile; markdown: string }; res: void }
  'memory:entries': { req: { file: MemoryFile }; res: MemoryEntry[] }
  'memory:budget': { req: { file: MemoryFile }; res: MemoryBudget }
  'memory:clear': { req: { file: MemoryFile }; res: void }

  /** Every DM contact, cloned or not — the 克隆 column is a picker, so un-cloned contacts are included with `state: 'none'`. */
  'clone:list': { req: void; res: Array<{ contactId: string; displayName: string; status: CloneStatus; messageCount?: number; lastContactAt?: number; avatarPath?: string }> }
  'clone:get': { req: { contactId: string }; res: RelationshipProfile | undefined }
  'clone:status': { req: { contactId: string }; res: CloneStatus }
  'clone:sampleMessages': { req: { contactId: string; limit?: number }; res: WxMessage[] }
  'clone:start': { req: { contactId: string; range?: { from?: number; to?: number }; model?: ModelSelection; keepCorrections?: boolean }; res: void }
  'clone:cancel': { req: { contactId: string }; res: void }
  'clone:delete': { req: { contactId: string }; res: { affectedRules: string[] } }
  'clone:updateProfile': { req: { contactId: string; patch: Partial<Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>> }; res: RelationshipProfile }
  'clone:chat': { req: { contactId: string; threadId: ThreadId; text: string }; res: void }
  'clone:feedback': { req: { contactId: string; messageItemId: string; verdict: 'up' | 'down' | 'not_like'; correction?: string; saveAsSample?: boolean }; res: void }
  /** Director's notes shown next to the test chat (corrections the clone must obey + past episodes). */
  'clone:notes': { req: { contactId: string }; res: PersonaNote[] }
  'clone:deleteNote': { req: { contactId: string; at: number }; res: void }
  /**
   * Distil the test-chat transcript into corrections + an episode summary. No-op (ok:false) when the
   * transcript has not grown enough since the last reflection.
   */
  'clone:reflect': { req: { contactId: string; threadId: ThreadId }; res: { ok: boolean; corrections: number; episode?: string } }

  'autoreply:listRules': { req: void; res: AutoReplyRule[] }
  'autoreply:getRule': { req: { sessionId: string }; res: AutoReplyRule | undefined }
  'autoreply:saveRule': { req: AutoReplyRule; res: AutoReplyRule }
  'autoreply:setEnabled': { req: { sessionId: string; enabled: boolean }; res: void }
  'autoreply:deleteRule': { req: { sessionId: string }; res: void }
  'autoreply:listRecords': { req: { sessionId?: string; status?: AutoReplyRecord['status']; limit?: number }; res: AutoReplyRecord[] }
  'autoreply:recall': { req: { recordId: string }; res: { ok: boolean; error?: string } }
  'autoreply:listDrafts': { req: void; res: ReplyDraft[] }
  'autoreply:resolveDraft': { req: { draftId: string; decision: 'approve' | 'reject' | 'edit'; text?: string }; res: void }
  'autoreply:holdDraft': { req: { draftId: string }; res: void }
  'autoreply:retryDraft': { req: { draftId: string }; res: void }
  'autoreply:status': { req: void; res: { halted?: string; connection: string; accountId?: string; demo: boolean; queued: number; generating: Array<{ sessionId: string; name: string }> } }
  'autoreply:resume': { req: void; res: void }
  /** Reply to this chat's last message now, ignoring the quiet window and the already-tried latch. */
  'autoreply:triggerNow': { req: { sessionId: string }; res: { triggered: boolean; reason?: string } }

  'gateway:status': { req: void; res: Array<{ channel: ChannelKind; state: AdapterState; detail?: string }> }
  'gateway:connect': { req: { channel: ChannelKind }; res: void }
  'gateway:disconnect': { req: { channel: ChannelKind }; res: void }

  'diary:list': { req: void; res: Array<Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'>> }
  'diary:get': { req: { date: string }; res: DiaryEntry | undefined }
  'diary:generate': { req: { date: string; force?: boolean }; res: DiaryEntry }

  'file:read': { req: { path: string }; res: { content: string; mediaType: string } }
  'file:write': { req: { path: string; content: string }; res: void }
  'file:reveal': { req: { path: string }; res: void }
}

export type InvokeChannel = keyof InvokeMap
export type InvokeReq<K extends InvokeChannel> = InvokeMap[K]['req']
export type InvokeRes<K extends InvokeChannel> = InvokeMap[K]['res']

/** main → renderer push events */
export interface EventMap {
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
  'diary:progress': { date: string; step: string; fraction: number }
  'app:toast': ToastPayload
  'app:update': UpdateStatus
  'app:closeRequested': { reason: 'window_close' }
  'app:command': { command: string; payload?: unknown }
}

export type EventChannel = keyof EventMap

export interface AiwcBridge {
  invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>>
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  /** 'electron' in the app, 'web' when running in a plain browser with the mock bridge. */
  readonly runtime: 'electron' | 'web'
  readonly platform: 'darwin' | 'win32' | 'linux'
}

export const INVOKE_CHANNELS = [
  'app:getInfo', 'app:checkUpdate', 'app:exportLogs', 'app:openPath', 'app:openUrl', 'app:pickDirectory', 'app:setCloseBehaviorOnce',
  'config:get', 'config:set', 'secret:set', 'secret:has', 'secret:reveal', 'secret:delete',
  'ai:testModel', 'ai:listRemoteModels', 'ai:discoverModels', 'ai:listLocalSttModels', 'ai:downloadSttModel', 'ai:cancelSttDownload', 'ai:deleteSttModel', 'ai:setDefaultSttModel',
  'substrate:status', 'substrate:detectWeChat', 'substrate:listAccounts', 'substrate:verifyAccount', 'substrate:acquireKeys', 'substrate:setManualKey', 'substrate:testConnection', 'substrate:connect', 'substrate:sync',
  'substrate:listSessions', 'substrate:getSession', 'substrate:listMessages', 'substrate:getContext', 'substrate:search', 'substrate:listContacts', 'substrate:listGroupMembers', 'substrate:stats', 'substrate:resolveMedia', 'substrate:transcribeVoice', 'substrate:setSessionFlags', 'substrate:removeIndex', 'substrate:rebuildIndex', 'substrate:export',
  'agent:submit', 'agent:listThreads', 'agent:getThread', 'agent:renameThread', 'agent:pinThread', 'agent:deleteThread', 'agent:exportThread', 'agent:listSkills', 'agent:listModels', 'agent:suggestPrompts',
  'memory:read', 'memory:write', 'memory:entries', 'memory:budget', 'memory:clear',
  'clone:list', 'clone:get', 'clone:status', 'clone:sampleMessages', 'clone:start', 'clone:cancel', 'clone:delete', 'clone:updateProfile', 'clone:chat', 'clone:feedback', 'clone:notes', 'clone:deleteNote', 'clone:reflect',
  'autoreply:listRules', 'autoreply:getRule', 'autoreply:saveRule', 'autoreply:setEnabled', 'autoreply:deleteRule', 'autoreply:listRecords', 'autoreply:recall', 'autoreply:listDrafts', 'autoreply:resolveDraft', 'autoreply:holdDraft', 'autoreply:retryDraft', 'autoreply:status', 'autoreply:resume', 'autoreply:triggerNow',
  'gateway:status', 'gateway:connect', 'gateway:disconnect',
  'diary:list', 'diary:get', 'diary:generate',
  'file:read', 'file:write', 'file:reveal',
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'agent:event', 'substrate:event', 'substrate:keyStep', 'gateway:event', 'memory:changed', 'clone:status', 'autoreply:draft', 'autoreply:record', 'autoreply:rulesChanged', 'diary:progress', 'app:toast', 'app:update', 'app:closeRequested', 'app:command',
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
