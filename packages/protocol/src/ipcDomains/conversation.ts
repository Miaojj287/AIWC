/**
 * IPC channels for the Agent conversation (composer, attachments, rollback, fork, archive). Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type { ItemId, ThreadId } from '../ids'
import type { ThreadSummary } from '../ipc'
import type { ComposerDraftRecord } from '../attachments'

/** Invoke channels (the Agent conversation (composer, attachments, rollback, fork, archive)). */
export interface ConversationInvokeMap {
  /** 归档 / 取消归档 a desktop thread: archived threads leave the history list and search but still open. */
  'agent:archiveThread': { req: { threadId: ThreadId; archived: boolean }; res: void }
  /** The 已归档 list: archived desktop threads, newest first; page with `offset`. */
  'agent:listArchivedThreads': { req: { limit?: number; offset?: number }; res: ThreadSummary[] }
  /**
   * 从这一轮分出新会话: a new desktop thread whose history is the source thread up to and including the turn that holds
   * `throughItemId`. `title` is the new thread's name (the renderer words it).
   */
  'agent:forkThread': { req: { threadId: ThreadId; throughItemId: ItemId; title: string }; res: ThreadSummary }
  /**
   * Unsent composer drafts, keyed by thread id (`new` = the draft of a conversation not created yet). Bounded by the
   * main process: the oldest drafts lose their attachments first, then the oldest drafts go.
   */
  'composer:loadDrafts': { req: void; res: Array<{ key: string; draft: ComposerDraftRecord; updatedAt: number }> }
  /** Store (or with `draft: null` forget) one draft; the renderer debounces typing. */
  'composer:saveDraft': { req: { key: string; draft: ComposerDraftRecord | null }; res: void }
}

/** Push events (the Agent conversation (composer, attachments, rollback, fork, archive)). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled in as channels are added
export interface ConversationEventMap {}

export const CONVERSATION_INVOKE_CHANNELS = [
  'agent:archiveThread',
  'agent:listArchivedThreads',
  'agent:forkThread',
  'composer:loadDrafts',
  'composer:saveDraft',
] as const satisfies readonly (keyof ConversationInvokeMap)[]
export const CONVERSATION_EVENT_CHANNELS = [] as const satisfies readonly (keyof ConversationEventMap)[]
