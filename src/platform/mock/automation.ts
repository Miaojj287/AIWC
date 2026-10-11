/** automation:* in the web preview: there is no dock, so the badge count is accepted and dropped. */
import type { HandlersFor } from './core'

export function automationHandlers(): HandlersFor<'automation'> {
  return { 'automation:setBadge': () => undefined }
}
