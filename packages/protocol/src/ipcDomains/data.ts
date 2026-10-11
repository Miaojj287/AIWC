/**
 * IPC channels for local data management, file preview and updates. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type { UpdateStatus } from '../ipc'

// ---- 本地数据管理 ------------------------------------------------------------------------------

/** What the 数据 settings page groups the data root (and the WeChat cache) into. */
export const STORAGE_CATEGORIES = [
  /** mirror.db: the local index of chats, contacts and messages. */
  'index',
  /** Decrypted plaintext copies of WeChat's databases (wcdb-plain). */
  'plaintext',
  /** Decrypted images / videos / stickers and files staged for in-app preview. */
  'media',
  /** Agent conversations (rollouts + their index). */
  'conversations',
  /** MEMORY / USER / SOUL / AGENTS and AI clones. */
  'memory',
  /** Auto-reply records, model usage, scheduled tasks, daily to-dos, channel state. */
  'features',
  'skills',
  'pets',
  /** The Agent's shell workspace. */
  'workspace',
  'exports',
  'logs',
  /** Settings, key store and anything not listed above. */
  'other',
] as const
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number]

/** Categories `storage:clear` accepts: caches that are rebuilt on demand. */
export const CLEARABLE_STORAGE_CATEGORIES = ['plaintext', 'media', 'logs'] as const
export type ClearableStorageCategory = (typeof CLEARABLE_STORAGE_CATEGORIES)[number]

export interface StorageCategoryUsage {
  id: StorageCategory
  bytes: number
  /** Files counted (the walk stops early on huge trees; then `partial` is set). */
  files: number
  partial?: boolean
  /** Where it lives (first location), for 打开位置. */
  path?: string
}

export interface StorageUsage {
  dataRoot: string
  /** Sum of the categories. */
  totalBytes: number
  categories: StorageCategoryUsage[]
  measuredAt: number
}

// ---- 文件预览 ----------------------------------------------------------------------------------

/** A run of text with the inline styles the preview keeps. */
export interface DocRun {
  text: string
  bold?: boolean
  italic?: boolean
}

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3; runs: DocRun[] }
  | { type: 'paragraph'; runs: DocRun[] }
  | { type: 'listItem'; level: number; ordered: boolean; runs: DocRun[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image' }

export interface SheetPreview {
  name: string
  rows: string[][]
  /** Rows / columns past the preview limits were left out. */
  truncated: boolean
}

/** Read-only, already-parsed content of an Office file (rendered as React, never as HTML). */
export type DocumentPreview =
  { kind: 'docx'; blocks: DocBlock[]; truncated: boolean } | { kind: 'xlsx'; sheets: SheetPreview[] }

// ---- 自动更新 ----------------------------------------------------------------------------------

/** Why 检查更新 is unavailable in this build (null → it is available). */
export type UpdateUnavailableReason = 'dev_build' | 'no_feed' | 'unsupported_platform'

export interface UpdateState {
  status: UpdateStatus
  unavailable: UpdateUnavailableReason | null
}

/** Invoke channels (local data management, file preview and updates). */
export interface DataInvokeMap {
  /** Measure what the data root (and the WeChat cache) holds, per category. */
  'storage:usage': { req: void; res: StorageUsage }
  /** Delete one rebuildable cache; returns the bytes freed. Plaintext copies close and reopen the WeChat data. */
  'storage:clear': { req: { category: ClearableStorageCategory }; res: { freedBytes: number } }
  /**
   * 清除全部数据: schedule the whole data root (settings, keys, index, conversations, memory…) for deletion
   * and relaunch; the next start deletes it before anything opens and shows onboarding.
   */
  'storage:wipeAll': { req: void; res: void }
  /** A .docx / .xlsx file inside the allow-list, parsed into a read-only preview. */
  'file:previewDocument': { req: { path: string }; res: DocumentPreview }
  /**
   * A WeChat file message's attachment, copied into the preview cache (WeChat's own folders stay outside
   * the file allow-list). The path comes from the substrate, never from the renderer.
   */
  'file:stageChatFile': { req: { sessionId: string; messageId: string }; res: { path: string; fileName: string } }
  /** Current update status and whether updating is possible in this build. */
  'update:getState': { req: void; res: UpdateState }
  /** Download the update found by app:checkUpdate; progress arrives as 'app:update'. */
  'update:download': { req: void; res: void }
  /** Quit and install the downloaded update now (it also installs on the next normal quit). */
  'update:install': { req: void; res: void }
}

/** Push events (local data management, file preview and updates). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 'app:update' (ipc.ts) carries update progress
export interface DataEventMap {}

export const DATA_INVOKE_CHANNELS = [
  'storage:usage',
  'storage:clear',
  'storage:wipeAll',
  'file:previewDocument',
  'file:stageChatFile',
  'update:getState',
  'update:download',
  'update:install',
] as const satisfies readonly (keyof DataInvokeMap)[]
export const DATA_EVENT_CHANNELS = [] as const satisfies readonly (keyof DataEventMap)[]
