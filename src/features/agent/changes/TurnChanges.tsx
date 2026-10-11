/**
 * 本轮改动 — under a finished turn: a folded line "N 项改动" that opens to what the turn's tools changed (workspace
 * files, memory entries, skills, sent messages). Each row says what and where; 撤销 (behind a confirmation) puts it
 * back where that is possible, and says why not otherwise (a sent message, a file too large to keep a copy of).
 */
import { BookMarked, ChevronRight, FileText, Send, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import type { AgentChange, AgentChangeKind } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, ConfirmDialog, cn, ICON_STROKE, toast, type IconComponent } from '@/kit'
import { invoke } from '@/platform/hooks'
import { CHANGE_ACTION_LABEL, CHANGE_KIND_LABEL, UNDO_FAILURE, undoUnavailableReason } from './changesModel'

const KIND_ICON: Record<AgentChangeKind, IconComponent> = {
  file: FileText,
  memory: BookMarked,
  skill: Sparkles,
  message: Send,
}

export interface TurnChangesProps {
  changes: readonly AgentChange[]
  /** After an undo, so the list reflects it at once (the push event also arrives). */
  onChanged?: () => void
}

export function TurnChanges({ changes, onChanged }: TurnChangesProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<AgentChange | undefined>()
  const [busy, setBusy] = useState(false)
  const listId = useId()
  if (changes.length === 0) return null

  const undo = async (change: AgentChange) => {
    setBusy(true)
    try {
      const result = await invoke('privacy:undoChange', { id: change.id })
      if (result.ok) toast.success(t('agent.changes.undoneToast'))
      else toast.error(t(UNDO_FAILURE[result.reason]))
      setPending(undefined)
      onChanged?.()
    } catch {
      toast.error(t('agent.changes.undoFailed.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-item="turn-changes">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('agent.changes.toggle')}
        onClick={() => setOpen(!open)}
        className="-mx-1 inline-flex min-w-0 items-center gap-1.5 self-start rounded-control px-1 text-caption text-fg-3 outline-none hover:text-fg-2"
      >
        <span className="min-w-0 truncate">{t('agent.changes.summary', { n: changes.length })}</span>
        <ChevronRight
          size={13}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('shrink-0 opacity-70 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open ? (
        <ul id={listId} className="m-0 flex list-none flex-col border-l border-line-8 p-0 pl-3">
          {changes.map((change) => (
            <ChangeRow key={change.id} change={change} onUndo={() => setPending(change)} />
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(o) => !o && !busy && setPending(undefined)}
        title={t('agent.changes.undoTitle')}
        description={
          pending?.kind === 'memory'
            ? t('agent.changes.undoMemoryDescription', { target: pending.target, excerpt: pending.excerpt ?? '' })
            : t('agent.changes.undoDescription', { target: pending?.target ?? '' })
        }
        confirmLabel={t('agent.changes.undoConfirm')}
        loading={busy}
        onConfirm={() => pending && void undo(pending)}
      />
    </div>
  )
}

function ChangeRow({ change, onUndo }: { change: AgentChange; onUndo: () => void }) {
  const t = useT()
  const Icon = KIND_ICON[change.kind]
  const unavailable = undoUnavailableReason(change)
  const undone = change.undoneAt !== undefined
  return (
    <li className="group/change flex min-h-7 min-w-0 items-center gap-2 text-caption">
      <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-fg-2">
        {t(CHANGE_ACTION_LABEL[change.action])} · {t(CHANGE_KIND_LABEL[change.kind])}
      </span>
      <span
        title={change.target}
        className={cn('min-w-0 truncate text-fg', change.kind === 'file' && 'font-mono', undone && 'line-through')}
      >
        {change.target}
      </span>
      {change.excerpt ? (
        <span title={change.excerpt} className="min-w-0 flex-1 truncate text-fg-3">
          {change.excerpt}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {undone ? (
        <span className="shrink-0 text-fg-3">{t('agent.changes.undone')}</span>
      ) : (
        <Button
          size="sm"
          variant="link"
          className="shrink-0 opacity-0 group-hover/change:opacity-100 focus-visible:opacity-100"
          disabled={unavailable !== undefined}
          disabledReason={unavailable ? t(unavailable) : undefined}
          onClick={onUndo}
        >
          {t('agent.changes.undo')}
        </Button>
      )}
    </li>
  )
}
