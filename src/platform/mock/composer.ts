/**
 * composer:* — unsent Agent drafts kept in localStorage (the main process keeps them in a file). Mock data, not UI copy.
 */
import type { ComposerDraftRecord, InvokeRes, ReasoningEffort } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const DRAFTS_KEY = 'aiwc.mock.composerDrafts'

type DraftRows = InvokeRes<'composer:loadDrafts'>

/** The demo model sees images and offers reasoning levels, so the composer's controls show in the web preview. */
export const MOCK_DEMO_MODEL_EXTRAS: { supportsVision: boolean; reasoningLevels: ReasoningEffort[] } = {
  supportsVision: true,
  reasoningLevels: ['low', 'medium', 'high'],
}

export function composerHandlers(ctx: MockContext): HandlersFor<'composer'> {
  const read = (): DraftRows => ctx.kv.get<DraftRows>(DRAFTS_KEY, [])
  return {
    'composer:loadDrafts': () => read(),
    'composer:saveDraft': ({ key, draft }: { key: string; draft: ComposerDraftRecord | null }) => {
      const rest = read().filter((row) => row.key !== key)
      const empty = !draft || (!draft.text.trim() && !draft.mentions.length && !draft.attachments.length)
      ctx.kv.set(DRAFTS_KEY, empty ? rest : [{ key, draft, updatedAt: ctx.now() }, ...rest])
    },
  }
}
