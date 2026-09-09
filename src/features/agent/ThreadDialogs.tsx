/**
 * Thread-level dialogs (CLAUDE.md §4.4): rename (form), compact (confirm '压缩上下文？'), clear and
 * delete (danger), and the compaction summary viewer. Controlled by the panel via `dialog`.
 */
import { Layers } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThreadId } from '@aiwc/protocol'
import { Button, ConfirmDialog, DangerDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormDialog, FormDialogField, Input } from '@/kit'

export type ThreadDialog =
  | { kind: 'rename'; threadId: ThreadId; title: string }
  | { kind: 'compact'; threadId: ThreadId }
  | { kind: 'clear'; threadId: ThreadId }
  | { kind: 'delete'; threadId: ThreadId; title: string }
  | { kind: 'summary'; threadId: ThreadId; summary: string | undefined }

export interface ThreadDialogsProps {
  dialog: ThreadDialog | undefined
  onClose: () => void
  onRename: (id: ThreadId, title: string) => Promise<void> | void
  onCompact: (id: ThreadId) => Promise<void> | void
  onClear: (id: ThreadId) => Promise<void> | void
  onDelete: (id: ThreadId) => Promise<void> | void
}

export function ThreadDialogs({ dialog, onClose, onRename, onCompact, onClear, onDelete }: ThreadDialogsProps) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (dialog?.kind === 'rename') setTitle(dialog.title)
    setBusy(false)
  }, [dialog])

  const run = async (fn: () => Promise<void> | void) => {
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
        title="重命名会话"
        submitLabel="保存"
        loading={busy}
        submitDisabled={title.trim().length === 0}
        submitDisabledReason="名称不能为空"
        onSubmit={() => {
          if (dialog?.kind === 'rename') void run(() => onRename(dialog.threadId, title))
        }}
      >
        <FormDialogField label="名称" htmlFor="agent-thread-title">
          <Input id="agent-thread-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={60} placeholder="会话名称" />
        </FormDialogField>
      </FormDialog>

      <ConfirmDialog
        open={dialog?.kind === 'compact'}
        onOpenChange={openChange}
        icon={Layers}
        tone="accent"
        title="压缩上下文？"
        description="会把之前的对话与引用整理成一段摘要，保留结论、待办与文件引用，释放大部分上下文。压缩后无法恢复原始对话。"
        confirmLabel="压缩"
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'compact') void run(() => onCompact(dialog.threadId))
        }}
      />

      <DangerDialog
        open={dialog?.kind === 'clear'}
        onOpenChange={openChange}
        title="清空上下文？"
        description="会移除这个会话里的全部消息、工具调用记录和引用，Agent 将从零开始。此操作不可恢复。"
        confirmLabel="清空"
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'clear') void run(() => onClear(dialog.threadId))
        }}
      />

      <DangerDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={openChange}
        title="删除会话？"
        description={dialog?.kind === 'delete' ? `将永久删除「${dialog.title || '新会话'}」及其全部记录，无法恢复。` : undefined}
        confirmLabel="删除"
        loading={busy}
        onConfirm={() => {
          if (dialog?.kind === 'delete') void run(() => onDelete(dialog.threadId))
        }}
      />

      <Dialog open={dialog?.kind === 'summary'} onOpenChange={openChange}>
        <DialogContent size="lg">
          <DialogHeader icon={Layers} tone="accent" title="压缩摘要" description="压缩时保留下来的结论、待办与引用。" />
          <DialogBody className="max-h-[50vh]">
            {dialog?.kind === 'summary' && dialog.summary ? (
              <p className="m-0 whitespace-pre-wrap break-words text-body leading-5 text-fg select-text">{dialog.summary}</p>
            ) : (
              <p className="m-0 text-caption text-fg-3">没有找到摘要内容。</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
