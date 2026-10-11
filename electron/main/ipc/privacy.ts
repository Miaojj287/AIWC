/**
 * Privacy & control channels: 总是允许 grants (list / revoke), the OS permissions auto-send needs, and the Agent change
 * journal (list a thread's changes, undo one). Inputs are validated here; the services live in composePrivacy.
 */
import { z } from 'zod'
import { GRANT_KEY_RE, asThreadId } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

const threadIdSchema = z.string().min(1).max(128)
const revokeSchema = z.strictObject({
  scope: z.enum(['thread', 'global']),
  key: z.string().regex(GRANT_KEY_RE),
  threadId: threadIdSchema.optional(),
})
const changeIdSchema = z.strictObject({ id: z.string().regex(/^chg_[A-Za-z0-9_-]{6,32}$/) })

export function registerPrivacyIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { grants, permissions, changes } = ctx.privacy

  handle('privacy:listGrants', () => grants.list())
  handle('privacy:revokeGrant', (req) => {
    const { scope, key, threadId } = revokeSchema.parse(req)
    return grants.revoke({ scope, key, ...(threadId ? { threadId: asThreadId(threadId) } : {}) })
  })
  handle('privacy:autoSendPermissions', () => permissions.check())
  handle('privacy:listChanges', (req) => changes.list(asThreadId(threadIdSchema.parse(req?.threadId))))
  handle('privacy:undoChange', (req) => changes.undo(changeIdSchema.parse(req).id))
}
