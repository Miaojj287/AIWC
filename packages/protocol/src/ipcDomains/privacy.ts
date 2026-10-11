/**
 * IPC channels for approvals, grants, diagnostics and redacted exports. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type { ThreadId, TurnId } from '../ids'
import type { GrantScope } from '../ops'
import type { AgentChange, AgentGrant, AutoSendPermissions, UndoChangeResult } from '../privacy'

/** Invoke channels (approvals, grants, diagnostics and redacted exports). */
export interface PrivacyInvokeMap {
  /** Every 总是允许 grant: the global ones, then each desktop thread's own. */
  'privacy:listGrants': { req: void; res: AgentGrant[] }
  /** Revoke one grant; the next matching call asks again. */
  'privacy:revokeGrant': { req: { scope: GrantScope; key: string; threadId?: ThreadId }; res: void }
  /** The OS permissions WeChat auto-send needs, checked now (never prompts). */
  'privacy:autoSendPermissions': { req: void; res: AutoSendPermissions }
  /** What the Agent changed in a thread, oldest first. */
  'privacy:listChanges': { req: { threadId: ThreadId }; res: AgentChange[] }
  /** Put back what one change replaced (file content, memory entry, skill). */
  'privacy:undoChange': { req: { id: string }; res: UndoChangeResult }
}

/** Push events (approvals, grants, diagnostics and redacted exports). */
export interface PrivacyEventMap {
  /** A grant was added (总是允许) or revoked. */
  'privacy:grantsChanged': { scope: GrantScope; threadId?: ThreadId }
  /** The change journal of a thread gained or undid an entry. */
  'privacy:changes': { threadId: ThreadId; turnId?: TurnId }
}

export const PRIVACY_INVOKE_CHANNELS = [
  'privacy:listGrants',
  'privacy:revokeGrant',
  'privacy:autoSendPermissions',
  'privacy:listChanges',
  'privacy:undoChange',
] as const satisfies readonly (keyof PrivacyInvokeMap)[]
export const PRIVACY_EVENT_CHANNELS = [
  'privacy:grantsChanged',
  'privacy:changes',
] as const satisfies readonly (keyof PrivacyEventMap)[]
