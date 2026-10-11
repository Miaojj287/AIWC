/**
 * The thread's composer block, shared by the panel and the Agent window through ThreadConversation (CLAUDE.md §12):
 * queued messages, then the Composer wired to the thread — draft text / chips / attachments, ↑ history, the send key
 * from 设置 › 常规, the queue (⌥↵), and the toolbar (permission mode · context ring · reasoning effort · model).
 * Images on a model that cannot see them get an inline warning; the reasoning select only shows for models that
 * offer reasoning levels.
 */
import { useMemo } from 'react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { ModelSelect, PermissionSelect, ReasoningEffortSelect } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { Composer } from './Composer'
import { ContextRing } from './composer/ContextRing'
import { QueuedInputList } from './composer/QueuedInputList'
import { defaultMentionSources } from './mentionSources'
import { emptyDraft, type ThreadItem } from './model'
import { mergeIntoDraft, useQueuedInputs, useQueueHeld, useQueueStore } from './queuedInputs'
import { runLocalCommand, slashMenuItems } from './slashCommands'
import type { AgentSurface } from './useAgentSurface'

const NO_ITEMS: readonly ThreadItem[] = []

/** Text parts of the thread's prompts, oldest first (↑ / ↓ in an empty composer). Attachments are not replayed. */
export function promptHistory(items: readonly ThreadItem[]): string[] {
  return items.flatMap((it) =>
    it.kind === 'user'
      ? [
          it.content
            .map((p) => (p.type === 'text' ? p.text : ''))
            .join('\n')
            .trim(),
        ].filter(Boolean)
      : [],
  )
}

export function ThreadComposer({ surface, wide }: { surface: AgentSurface; wide: boolean }) {
  const t = useT()
  const { active, view, draft, draftKey, focusSeq, models, skills, streaming, settings, store, setDialog } = surface
  const sendKey = useConfig((c) => c.ui.composerSendKey) ?? 'enter'
  const defaultModel = useConfig((c) => c.ai.defaultModel)
  const threadId = active?.threadId
  const queue = useQueuedInputs(threadId)
  const held = useQueueHeld(threadId)
  const items = view?.items ?? NO_ITEMS
  const history = useMemo(() => promptHistory(items), [items])
  // `/`: local commands (/compact, /new, /export, /clear) first, then the enabled skills.
  const slashItems = useMemo(() => slashMenuItems(skills, t), [skills, t])
  const selection = settings?.model ?? defaultModel
  const model = selection
    ? models.find((m) => m.providerId === selection.providerId && m.modelId === selection.modelId)
    : undefined
  const levels = model?.reasoningLevels ?? []
  const hasImages = Boolean(draft.attachments?.some((a) => a.part.type === 'image'))
  const placeholder = streaming
    ? t('agent.composer.placeholderRunning')
    : items.length > 0
      ? t('agent.composer.placeholderFollowUp')
      : undefined

  const queueDraft = () => {
    if (!threadId) return
    useQueueStore.getState().enqueue(threadId, draft)
    store().setDraft(draftKey, { ...emptyDraft(), attachments: [] })
  }

  return (
    <>
      {threadId ? (
        <QueuedInputList
          items={queue}
          held={held}
          onSendNow={(item) => {
            const taken = useQueueStore.getState().take(threadId, item.id)
            useQueueStore.getState().setHeld(threadId, false)
            if (taken) void store().send(threadId, taken.draft)
          }}
          onEdit={(item) => {
            const taken = useQueueStore.getState().take(threadId, item.id)
            if (!taken) return
            store().setDraft(draftKey, mergeIntoDraft(store().drafts[draftKey], taken.draft))
            store().requestFocus()
          }}
          onRemove={(item) => useQueueStore.getState().remove(threadId, item.id)}
        />
      ) : null}
      <Composer
        key={draftKey}
        disabled={!active || !view?.loaded || Boolean(view.loadError)}
        value={draft.text}
        onValueChange={(text) => store().setDraft(draftKey, { text })}
        mentions={draft.mentions}
        onMentionsChange={(mentions) => store().setDraft(draftKey, { mentions })}
        attachments={draft.attachments}
        onAttachmentsChange={(attachments) => store().setDraft(draftKey, { attachments })}
        attachmentWarning={
          hasImages && model?.supportsVision === false
            ? t('agent.attachments.noVision', { model: model.label })
            : undefined
        }
        sendKey={sendKey}
        onQueue={threadId ? queueDraft : undefined}
        onSubmit={() => {
          if (!runLocalCommand(surface, draft.text)) void store().sendDraft()
        }}
        onStop={threadId ? () => void store().interrupt(threadId) : undefined}
        history={history}
        placeholder={placeholder}
        streaming={streaming}
        focusSeq={focusSeq}
        mentionSources={defaultMentionSources}
        skills={slashItems}
        maxRows={wide ? 12 : 8}
        toolbarLeft={
          <PermissionSelect
            value={settings?.permissionMode ?? 'ask'}
            disabled={!active}
            onChange={(mode) => threadId && void store().updateSettings(threadId, { permissionMode: mode })}
            onOpenRules={() => runCommand('tab.openSettings', { page: 'ai', highlight: 'ai.permissions' })}
          />
        }
        toolbarRight={
          <>
            <ContextRing
              usage={view?.usage}
              disabled={!active}
              onCompact={threadId ? () => setDialog({ kind: 'compact', threadId }) : undefined}
            />
            {levels.length > 0 ? (
              <ReasoningEffortSelect
                levels={levels}
                value={settings?.reasoningEffort}
                modelDefault={model?.reasoningEffort}
                disabled={!active}
                onChange={(reasoningEffort) => threadId && void store().updateSettings(threadId, { reasoningEffort })}
              />
            ) : null}
            <ModelSelect
              models={models}
              value={settings?.model}
              disabled={!active}
              onChange={(next) => threadId && void store().updateSettings(threadId, { model: next })}
              onManage={() => runCommand('tab.openSettings', { page: 'ai' })}
            />
          </>
        }
      />
    </>
  )
}
