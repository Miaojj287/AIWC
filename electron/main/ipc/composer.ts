/**
 * composer:* — the Agent composer's unsent drafts (survive a restart). Renderer input is untrusted: the key and the
 * draft are validated (shape, sizes, attachment limits) before anything reaches disk.
 */
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import { createDraftStore, draftKeySchema, draftRecordSchema } from '../services/draftStore'
import type { Handle, HostBridge } from './register'

export function registerComposerIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const store = createDraftStore({ file: ctx.paths.composerDraftsFile, logger: ctx.logger.child('drafts') })

  handle('composer:loadDrafts', () => store.load())
  handle('composer:saveDraft', async (req) => {
    const key = draftKeySchema.safeParse(req?.key)
    const draft = req?.draft === null ? { success: true as const, data: null } : draftRecordSchema.safeParse(req?.draft)
    if (!key.success || !draft.success) throw new Error(t('main.composer.invalidDraft'))
    await store.save(key.data, draft.data)
  })
}
