/**
 * Thread-level dialogs (CLAUDE.md §4.4): rename (form), compact (confirm '压缩上下文？'), clear and
 * delete (danger), the compaction summary viewer and 导出会话 (ThreadExportDialog). Controlled by the panel via `dialog`.
 */
import { Layers, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThreadExportOptions, ThreadId, UserInput } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Button,
  ConfirmDialog,
  DangerDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormDialog,
  FormDialogField,
  Input,
} from '@/kit'
import { isUntitledTitle } from './model'
import { ThreadExportDialog } from './ThreadExportDialog'

export type ThreadDialog =
  | { kind: 'rename'; threadId: ThreadId; title: string }
  /** `instructions`: what `/compact …` asked the summary to keep. */
  | { kind: 'compact'; threadId: ThreadId; instructions?: string }
  | { kind: 'clear'; threadId: ThreadId }
  | { kind: 'delete'; threadId: ThreadId; title: string }
  | { kind: 'summary'; threadId: ThreadId; summary: string | undefined }
  | { kind: 'export'; threadId: ThreadId }
  /** 编辑 / 重新生成 an earlier turn: the turns after it are discarded too. */
  | { kind: 'rewind'; threadId: ThreadId; fromItemId: string; input: UserInput; laterTurns: number }

export interface ThreadDialogsProps {
  dialog: ThreadDialog | undefined
  onClose: () => void
  onRename: (id: ThreadId, title: string) => Promise<void> | void
  onCompact: (id: ThreadId, instructions?: string) => Promise<void> | void
  onClear: (id: ThreadId) => Promise<void> | void
  onDelete: (id: ThreadId) => Promise<void> | void
  onRewind: (id: ThreadId, fromItemId: string, input: UserInput) => Promise<unknown> | void
  onExport: (id: ThreadId, options: ThreadExportOptions) => Promise<void> | void
}

export function ThreadDialogs({
  dialog,
  onClose,
  onRename,
  onCompact,
  onClear,
  onDelete,
  onRewind,
  onExport,
}: ThreadDialogsProps) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (dialog?.kind === 'rename') setTitle(isUntitledTitle(dialog.title) ? '' : dialog.title)
    setBusy(false)
  }, [dialog])

  const run = async (fn: () => Promise<unknown> | void) => {
    setBusy(true)
    try {
      await fn()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const openChange = (o: boolean) => {
    if (!o && !busy) onClose()
  }

  return (
    <>
      <FormDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={openChange}
        title={t('agent.dialog.renameTitle')}
        submitLabel={t('common.save')}
        loading={busy}
        submitDisabled={title.trim().length === 0}
        submitDisabledReason={t('agent.dialog.nameRequired')}
        onSubmit={() => {
          if (dialog?.kind === 'rename') void run(() => onRename(dialog.threadId, title))
        }}
      >
        <FormDialogField label={t('agent.dialog.nameLabel')} htmlFor="agent-thread-title">
          <Input
            id="agent-thread-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            maxLength={60}
            placeholder={t('agent.dialog.namePlaceholder')}
          />
        </FormDialogField>
      </FormDialog>

      <ConfirmDialog
        open={dialog?.kind === 'compact'}
        onOpenChange={openChange}
        icon={Layers}
        tone="accent"
        title={t('agent.dialog.compactTitle')}
        description={
          dialog?.kind === 'compact' && dialog.instructions
            ? `${t('agent.dialog.compactDescription')} ${t('agent.dialog.compactFocus', { text: dialog.instructions })}`
            : t('agent.dialog.compactDescription')
        }
        confirmLabel={t('agent.dialog.compactConfirm')}
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'compact') void run(() => onCompact(dialog.threadId, dialog.instructions))
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === 'rewind'}
        onOpenChange={openChange}
        icon={Undo2}
        tone="warn"
        title={t('agent.stream.rewind.confirmTitle')}
        description={
          dialog?.kind === 'rewind' ? t('agent.stream.rewind.confirmDescription', { n: dialog.laterTurns }) : undefined
        }
        confirmLabel={t('agent.stream.rewind.confirm')}
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'rewind') void run(() => onRewind(dialog.threadId, dialog.fromItemId, dialog.input))
        }}
      />

      <DangerDialog
        open={dialog?.kind === 'clear'}
        onOpenChange={openChange}
        title={t('agent.dialog.clearTitle')}
        description={t('agent.dialog.clearDescription')}
        confirmLabel={t('common.clear')}
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'clear') void run(() => onClear(dialog.threadId))
        }}
      />

      <DangerDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={openChange}
        title={t('agent.dialog.deleteTitle')}
        description={
          dialog?.kind === 'delete'
            ? t('agent.dialog.deleteDescription', {
                title: isUntitledTitle(dialog.title) ? t('agent.thread.untitled') : dialog.title,
              })
            : undefined
        }
        confirmLabel={t('common.delete')}
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'delete') void run(() => onDelete(dialog.threadId))
        }}
      />

      {dialog?.kind === 'export' ? (
        <ThreadExportDialog
          key={dialog.threadId}
          open
          onOpenChange={openChange}
          onExport={async (options) => {
            await onExport(dialog.threadId, options)
            onClose()
          }}
        />
      ) : null}

      <Dialog open={dialog?.kind === 'summary'} onOpenChange={openChange}>
        <DialogContent size="lg">
          <DialogHeader
            icon={Layers}
            tone="accent"
            title={t('agent.dialog.summaryTitle')}
            description={t('agent.dialog.summaryDescription')}
          />
          <DialogBody className="max-h-[50vh]">
            {dialog?.kind === 'summary' && dialog.summary ? (
              <p className="m-0 whitespace-pre-wrap break-words text-body leading-5 text-fg select-text">
                {dialog.summary}
              </p>
            ) : (
              <p className="m-0 text-caption text-fg-3">{t('agent.dialog.summaryEmpty')}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
