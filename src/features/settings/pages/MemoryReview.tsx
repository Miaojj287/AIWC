/**
 * 设置 › 记忆 › 待确认: points distilled from idle chats (自动写入记忆) and `remember` calls held by 写入前需要确认.
 * Nothing here is in memory yet: 写入 sends it through the memory store (budget, entry cap and drift checks apply),
 * 编辑 lets the user reword it or move it to the other file first, 忽略 drops it.
 */
import { Check, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import {
  MEMORY_PROPOSAL_FILES,
  type MemoryProposal,
  type MemoryProposalAcceptFailure,
  type MemoryProposalFile,
} from '@aiwc/protocol'
import { Badge, Button, Card, ConfirmDialog, EmptyState, InlineHint, SegmentedControl, Textarea, toast } from '@/kit'
import { useT, type MessageKey } from '@/i18n'
import { formatRelative } from '@/platform/format'
import { invoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'
import { memoryFileName } from '../memoryModel'
import { ensureMemoryReview, useMemoryReview } from '../memoryReviewStore'
import { Section } from '../pageKit'

const FAILURE_KEY: Record<MemoryProposalAcceptFailure, MessageKey> = {
  not_found: 'settings.memory.review.failed.notFound',
  duplicate: 'settings.memory.review.failed.duplicate',
  over_budget: 'settings.memory.review.failed.overBudget',
  over_count: 'settings.memory.review.failed.overCount',
  blocked: 'settings.memory.review.failed.blocked',
}

const ORIGIN_KEY: Record<MemoryProposal['origin'], MessageKey> = {
  extraction: 'settings.memory.review.origin.extraction',
  agent: 'settings.memory.review.origin.agent',
}

function ProposalRow({ proposal }: { proposal: MemoryProposal }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(proposal.text)
  const [file, setFile] = useState<MemoryProposalFile>(proposal.file)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  const trimmed = text.trim()

  const accept = async () => {
    setBusy(true)
    setFailure(undefined)
    const target = editing ? file : proposal.file
    const name = memoryFileName(target)
    try {
      const r = await invoke('memoryReview:accept', {
        id: proposal.id,
        ...(editing ? { text: trimmed, file } : {}),
      })
      if (r.ok) toast.success(t('settings.memory.review.written', { file: name }))
      else if (r.reason === 'duplicate' || r.reason === 'not_found')
        toast.info(t(FAILURE_KEY[r.reason], { file: name }))
      else setFailure(t(FAILURE_KEY[r.reason], { file: name }))
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    try {
      await invoke('memoryReview:dismiss', { ids: [proposal.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const meta = [
    t(ORIGIN_KEY[proposal.origin]),
    proposal.threadTitle ? t('settings.memory.review.fromThread', { title: proposal.threadTitle }) : undefined,
    formatRelative(proposal.createdAt),
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-2 border-b border-line-6 px-4 py-3 last:border-b-0">
      {editing ? (
        <>
          <Textarea
            autosize
            minRows={2}
            maxRows={6}
            aria-label={t('settings.memory.review.textLabel')}
            value={text}
            error={!trimmed}
            onChange={(e) => setText(e.target.value)}
          />
          <SegmentedControl
            size="sm"
            aria-label={t('settings.memory.review.fileLabel')}
            options={MEMORY_PROPOSAL_FILES.map((f) => ({ value: f, label: memoryFileName(f) }))}
            value={file}
            onValueChange={setFile}
            className="self-start"
          />
        </>
      ) : (
        <p className="break-words text-body leading-5 text-fg">{proposal.text}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge tone="neutral" className="shrink-0 font-mono">
            {memoryFileName(editing ? file : proposal.file)}
          </Badge>
          <span className="min-w-0 truncate text-caption text-fg-3" title={meta.join(' · ')}>
            {meta.join(' · ')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setText(proposal.text)
                setFile(proposal.file)
                setFailure(undefined)
              }}
            >
              {t('settings.memory.review.cancel')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" icon={X} onClick={() => void dismiss()}>
                {t('settings.memory.review.dismiss')}
              </Button>
              <Button variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
                {t('settings.memory.review.edit')}
              </Button>
            </>
          )}
          <Button
            variant={editing ? 'primary' : 'outline'}
            icon={Check}
            loading={busy}
            disabled={editing && !trimmed}
            disabledReason={editing && !trimmed ? t('settings.memory.review.emptyText') : undefined}
            onClick={() => void accept()}
          >
            {t('settings.memory.review.accept')}
          </Button>
        </div>
      </div>
      {failure ? <InlineHint kind="error">{failure}</InlineHint> : null}
    </div>
  )
}

export function MemoryReviewSection({ autoWrite }: { autoWrite: boolean }) {
  const t = useT()
  const { items, status } = useMemoryReview()
  const [confirmAll, setConfirmAll] = useState(false)

  const dismissAll = async () => {
    try {
      await invoke('memoryReview:dismiss', { ids: items.map((p) => p.id) })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setConfirmAll(false)
    }
  }

  let body
  if (status === 'error')
    body = (
      <EmptyState
        compact
        bordered
        variant="error"
        title={t('settings.memory.review.loadFailed')}
        action={{ label: t('common.retry'), onClick: () => void ensureMemoryReview() }}
      />
    )
  else if (status !== 'ready')
    body = <EmptyState compact bordered variant="loading" title={t('settings.memory.review.loading')} />
  else if (items.length === 0)
    body = (
      <EmptyState
        compact
        bordered
        title={t('settings.memory.review.emptyTitle')}
        description={autoWrite ? undefined : t('settings.memory.review.emptyOff')}
      />
    )
  else
    body = (
      <Card className="flex flex-col gap-0 p-0" role="list" aria-label={t('settings.memory.review.section')}>
        {items.map((p) => (
          <div role="listitem" key={p.id}>
            <ProposalRow proposal={p} />
          </div>
        ))}
      </Card>
    )

  return (
    <Section
      id="memory.review"
      title={t('settings.memory.review.section')}
      help={t('settings.memory.review.help')}
      aside={items.length > 0 ? t('settings.memory.review.count', { n: items.length }) : undefined}
      actions={
        items.length > 1 ? (
          <Button variant="ghost" onClick={() => setConfirmAll(true)}>
            {t('settings.memory.review.dismissAll')}
          </Button>
        ) : undefined
      }
    >
      {body}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('settings.memory.review.dismissAllTitle', { n: items.length })}
        description={t('settings.memory.review.dismissAllDescription')}
        confirmLabel={t('settings.memory.review.dismissAll')}
        cancelLabel={t('settings.memory.review.cancel')}
        onConfirm={() => void dismissAll()}
      />
    </Section>
  )
}
