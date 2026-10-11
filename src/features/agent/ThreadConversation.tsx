/**
 * ThreadConversation — everything below the thread switcher, shared by the panel and the Agent window
 * (CLAUDE.md §12): message list (or the hydrating / failed states), the composer block with its toolbar
 * (ThreadComposer: queue, attachments, permission mode, context ring, reasoning effort, model), the perched pet, and
 * the thread dialogs. An empty thread shows only the composer, a little above centre — no greeting, no sample prompts,
 * no accent (CLAUDE.md §14); DraftStart above it speaks only while no model is usable. While a tool call waits for
 * approval, the request takes the composer's slot (the draft stays mounted, hidden). The window layout only centres the same content at a
 * 760px reading width; nothing is added or removed per surface.
 */
import { AgentPet, hidePet, openPetSettings, PERCH_OVERLAP, perchInset, useCurrentPet } from '@/features/pets'
import { useT } from '@/i18n'
import { cn, EmptyState, modelLabelFor } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { findScopeProps } from '@/platform/focusScope'
import { APPROVAL_SCOPE_ATTR, ApprovalCard } from './ApprovalCard'
import { answerApproval } from './approvalGrants'
import { TurnChanges } from './changes/TurnChanges'
import { useThreadChanges } from './changes/useThreadChanges'
import { AGENT_FIND_SCOPE, useConversationFind } from './findRequests'
import { MessageList } from './MessageList'
import { DraftStart } from './messages/DraftStart'
import type { ApprovalRequest, ThreadItem } from './model'
import { pendingInputsOf } from './pendingInputs'
import { QuestionCard } from './QuestionCard'
import { answerQuestion } from './questionOps'
import { useAgentPetSignal } from './petSignal'
import { editedInput, inputOf, turnPrompt } from './rewind'
import { ThreadComposer } from './ThreadComposer'
import { ThreadDialogs } from './ThreadDialogs'
import { TurnAnnouncer } from './TurnAnnouncer'
import { TurnSignalNotice } from './TurnSignalNotice'
import type { AgentSurface } from './useAgentSurface'

const NO_ITEMS: readonly ThreadItem[] = []
const NO_APPROVALS: readonly ApprovalRequest[] = []

export interface ThreadConversationProps {
  surface: AgentSurface
  /** `panel` = the 360px column; `window` = the Agent window, messages and composer centred at 760px. */
  layout: 'panel' | 'window'
}

export function ThreadConversation({ surface, layout }: ThreadConversationProps) {
  const t = useT()
  const { active, view, models, hydrating, loadError, streaming, settings, store, setDialog, rewind } = surface
  const findSeq = useConversationFind((s) => s.seq)
  const changes = useThreadChanges(active?.threadId)
  const petConfig = useConfig((c) => c.pet)
  const pet = useCurrentPet(petConfig)
  const petSignal = useAgentPetSignal()
  const showPet = Boolean(petConfig?.enabled && pet)
  const wide = layout === 'window'
  const column = wide ? 'mx-auto w-full max-w-[760px]' : undefined
  const items = view?.items ?? NO_ITEMS
  const pendingInputs = pendingInputsOf(view)
  const isDraft = Boolean(
    active && view?.loaded && !view.loadError && items.length === 0 && !streaming && pendingInputs.length === 0,
  )
  const approval = view?.pendingApprovals[0]
  // An approval and a question never wait at once in practice (one tool call at a time); approvals go first.
  const question = approval ? undefined : view?.pendingQuestions?.[0]

  return (
    <>
      <div className={cn('flex min-h-0 flex-1 flex-col', isDraft && 'flex-auto overflow-y-auto px-4 pb-2')}>
        {active && view && isDraft ? (
          <DraftStart className={cn('mt-auto shrink-0 py-3', column)} />
        ) : active && view ? (
          <MessageList
            key={active.threadId}
            turnFooter={(turnId) => (
              <TurnChanges changes={changes.byTurn.get(turnId) ?? []} onChanged={changes.reload} />
            )}
            items={view.items}
            streaming={streaming}
            turnStartedAt={view.turnStartedAt}
            activeTurnId={view.currentTurnId}
            pendingInputs={pendingInputs}
            // The unanswered prompt is replaced, not repeated: rewind to it and run it again.
            onResendUnanswered={(item) => rewind(active.threadId, item.id, inputOf(item))}
            focusItemId={view.focusItemId}
            onFocusHandled={() => store().clearFocusItem(active.threadId)}
            pendingApprovals={view.pendingApprovals}
            loading={!view.loaded}
            loadError={view.loadError}
            onRetryLoad={() => void store().loadThread(active.threadId)}
            modelLabel={modelLabelFor(models, settings?.model)}
            scrollKey={active.threadId}
            findRequestSeq={findSeq}
            onQuoteSelection={(text) => void store().quoteText({ text })}
            // 编辑 / 重新发送 / 重新生成 / 重试 all rewind to the turn's prompt first, so the rejected answer leaves the
            // context instead of staying under a new turn (CLAUDE.md §5).
            onEditSubmit={(item, text, mentions) => {
              const input = editedInput(item, text, mentions)
              if (input) rewind(active.threadId, item.id, input)
            }}
            onResend={(text, mentions, attachments) =>
              void store().send(active.threadId, { text, mentions, attachments })
            }
            onRegenerate={(item) => {
              const prompt = turnPrompt(view.items, item.turnId)
              if (prompt) rewind(active.threadId, prompt.id, inputOf(prompt))
            }}
            onRetry={(item) => {
              const prompt = turnPrompt(view.items, item.turnId)
              if (prompt) rewind(active.threadId, prompt.id, inputOf(prompt))
              // the turn never recorded its prompt: it is back in the composer, so 重试 sends the composer
              else if (item.inputRestored) void store().send(active.threadId)
            }}
            onFork={(item) => void store().forkFromTurn(active.threadId, item.id)}
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
      <TurnAnnouncer
        key={active?.threadId ?? 'none'}
        streaming={streaming}
        items={items}
        pendingApprovals={view?.pendingApprovals ?? NO_APPROVALS}
      />

      <div className={cn('shrink-0 px-3 pb-3 pt-1', wide && 'px-6 pb-4')} {...findScopeProps(AGENT_FIND_SCOPE)}>
        <div className={cn('relative w-full', column)} {...{ [APPROVAL_SCOPE_ATTR]: '' }}>
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
          <TurnSignalNotice signal={view?.turnSignal} />
          {approval && active ? (
            <ApprovalCard
              key={approval.approvalId}
              request={approval}
              queued={(view?.pendingApprovals.length ?? 1) - 1}
              onResolve={(_id, decision, extra) => answerApproval(active.threadId, approval, decision, extra)}
            />
          ) : null}
          {question && active ? (
            <QuestionCard
              key={question.questionId}
              request={question}
              queued={(view?.pendingQuestions?.length ?? 1) - 1}
              onAnswer={(questionId, answer) => void answerQuestion(active.threadId, questionId, answer)}
            />
          ) : null}
          <div hidden={Boolean(approval || question)}>
            <ThreadComposer surface={surface} wide={wide} />
          </div>
        </div>
      </div>
      {/* Under an empty thread's composer: a little more room than above it, so the box sits just above centre. */}
      {isDraft ? <div className="min-h-0 flex-[1.4]" aria-hidden /> : null}

      <ThreadDialogs
        dialog={surface.dialog}
        onClose={() => setDialog(undefined)}
        onRename={(id, title) => store().rename(id, title)}
        onCompact={(id, instructions) => store().compact(id, instructions)}
        onClear={(id) => store().clearContext(id)}
        onDelete={(id) => store().remove(id)}
        onRewind={(id, fromItemId, input) => store().rewindTurn(id, fromItemId, input)}
        onExport={(id, options) => store().exportThread(id, options)}
      />
    </>
  )
}
