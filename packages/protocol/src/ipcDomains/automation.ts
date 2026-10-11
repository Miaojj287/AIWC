/**
 * IPC channels for scheduled-task recovery and automation. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */

/** Invoke channels (scheduled-task recovery and automation). */
export interface AutomationInvokeMap {
  /**
   * Agent threads that finished unseen or failed: the dock / taskbar badge shows this count (0 clears it).
   * The renderer owns the count because only it knows which thread the user is looking at.
   */
  'automation:setBadge': { req: { count: number }; res: void }
}

/** Push events (scheduled-task recovery and automation). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled in as channels are added
export interface AutomationEventMap {}

export const AUTOMATION_INVOKE_CHANNELS = [
  'automation:setBadge',
] as const satisfies readonly (keyof AutomationInvokeMap)[]
export const AUTOMATION_EVENT_CHANNELS = [] as const satisfies readonly (keyof AutomationEventMap)[]
