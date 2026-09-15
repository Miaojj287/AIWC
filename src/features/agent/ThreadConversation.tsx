/**
 * ThreadConversation — everything below the thread switcher, shared by the panel and the Agent window
 * (CLAUDE.md §12): message list (or the hydrating / failed states), the composer block with its toolbar
 * (permission mode, context ring, model), the perched pet, and the thread dialogs. The window layout only
 * centres the same content at a 760px reading width; nothing is added or removed per surface.
 */
import { runCommand } from '@/app/commands'
import { AgentPet, hidePet, openPetSettings, PERCH_OVERLAP, perchInset, useCurrentPet } from '@/features/pets'
import { useT } from '@/i18n'
import { cn, EmptyState, ModelSelect, modelLabelFor, PermissionSelect } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { Composer } from './Composer'
import { ContextRing } from './composer/ContextRing'
import { defaultMentionSources } from './mentionSources'
import { MessageList } from './MessageList'
import { useAgentPetSignal } from './petSignal'
import { ThreadDialogs } from './ThreadDialogs'
import type { AgentSurface } from './useAgentSurface'

export interface ThreadConversationProps {
  surface: AgentSurface
  /** `panel` = the 360px column; `window` = the Agent window, messages and composer centred at 760px. */
  layout: 'panel' | 'window'
}

export function ThreadConversation({ surface, layout }: ThreadConversationProps) {
  const t = useT()
  const {
    active,
    view,
    draft,
    draftKey,
    focusSeq,
    models,
    skills,
    hydrating,
    loadError,
    streaming,
    settings,
    store,
    setDialog,
    sendText,
  } = surface
  const petConfig = useConfig((c) => c.pet)
  const pet = useCurrentPet(petConfig)
  const petSignal = useAgentPetSignal()
  const showPet = Boolean(petConfig?.enabled && pet)
  const wide = layout === 'window'
  const column = wide ? 'mx-auto w-full max-w-[760px]' : undefined

  return (
    <>
      <div className="min-h-0 flex-1">
        {active && view ? (
          <MessageList
            key={active.threadId}
            items={view.items}
            streaming={streaming}
            turnStartedAt={view.turnStartedAt}
            pendingApprovals={view.pendingApprovals}
            suggestions={view.suggestions}
            loading={!view.loaded}
            loadError={view.loadError}
            onRetryLoad={() => void store().loadThread(active.threadId)}
            modelLabel={modelLabelFor(models, settings?.model)}
            onSuggestion={(text) => void sendText(text, draft.mentions)}
            onResolveApproval={(approvalId, decision) =>
              void store().resolveApproval(active.threadId, approvalId, decision)
            }
            onEdit={(text, mentions) => {
              store().setDraft(active.threadId, { text, mentions })
              store().requestFocus()
            }}
            onResend={(text, mentions) => void store().send(active.threadId, { text, mentions })}
            onViewSummary={(item) => {
              setDialog({ kind: 'summary', threadId: active.threadId, summary: item.summary })
              if (!item.summary)
                void store()
                  .loadCompactionSummary(active.threadId, item.summaryItemId ?? item.id)
                  .then((summary) => setDialog((d) => (d?.kind === 'summary' ? { ...d, summary } : d)))
            }}
            onCompact={() => setDialog({ kind: 'compact', threadId: active.threadId })}
            bottomInset={showPet && petConfig ? perchInset(petConfig.size) : undefined}
            contentClassName={column}
          />
        ) : hydrating ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState variant="loading" title={t('agent.panel.loadingThreads')} compact />
          </div>
        ) : loadError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              variant="error"
              title={t('agent.panel.threadsLoadFailed')}
              description={loadError}
              compact
              action={{ label: t('common.retry'), onClick: () => void store().hydrate() }}
            />
          </div>
        ) : null}
      </div>

      <div className={cn('flex shrink-0 flex-col items-center px-3 pb-2.5 pt-1', wide && 'px-6 pb-4')}>
        <div className={cn('relative flex w-full flex-col items-center gap-2', column)}>
          {showPet && pet && petConfig ? (
            <AgentPet
              pet={pet}
              config={petConfig}
              signal={petSignal}
              onOpenSettings={openPetSettings}
              onHide={() => void hidePet()}
              className="absolute right-2 z-10"
              style={{ bottom: `calc(100% - ${PERCH_OVERLAP + 4}px)` }}
            />
          ) : null}
          <Composer
            key={draftKey}
            disabled={!active || !view?.loaded || Boolean(view.loadError)}
            value={draft.text}
            onValueChange={(text) => store().setDraft(draftKey, { text })}
            mentions={draft.mentions}
            onMentionsChange={(mentions) => store().setDraft(draftKey, { mentions })}
            onSubmit={() => void store().sendDraft()}
            onStop={active ? () => void store().interrupt(active.threadId) : undefined}
            streaming={streaming}
            focusSeq={focusSeq}
            mentionSources={defaultMentionSources}
            skills={skills}
            maxRows={wide ? 12 : 8}
            toolbarLeft={
              <PermissionSelect
                value={settings?.permissionMode ?? 'ask'}
                disabled={!active}
                onChange={(mode) => active && void store().updateSettings(active.threadId, { permissionMode: mode })}
                onOpenRules={() => runCommand('tab.openSettings', { page: 'ai', highlight: 'permissions' })}
              />
            }
            toolbarRight={
              <>
                <ContextRing
                  usage={view?.usage}
                  disabled={!active}
                  onCompact={active ? () => setDialog({ kind: 'compact', threadId: active.threadId }) : undefined}
                />
                <ModelSelect
                  models={models}
                  value={settings?.model}
                  disabled={!active}
                  onChange={(model) => active && void store().updateSettings(active.threadId, { model })}
                  onManage={() => runCommand('tab.openSettings', { page: 'ai' })}
                />
              </>
            }
          />
          <span className="font-latin text-micro leading-4 text-fg-3">© {new Date().getFullYear()} AIWC</span>
        </div>
      </div>

      <ThreadDialogs
        dialog={surface.dialog}
        onClose={() => setDialog(undefined)}
        onRename={(id, title) => store().rename(id, title)}
        onCompact={(id) => store().compact(id)}
        onClear={(id) => store().clearContext(id)}
        onDelete={(id) => store().remove(id)}
      />
    </>
  )
}
