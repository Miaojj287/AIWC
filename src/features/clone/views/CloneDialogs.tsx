/**
 * Clone dialogs (board 153:415 ③④): 取消克隆 confirm, failure (模型错误 vs 有效消息过少), 重新克隆 with
 * 保留手动修正, and the danger 删除分身 confirm.
 */
import { Bot, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CloneStatus } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DangerDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/kit'
import { failureTitle } from '../cloneView'
import { deleteImpactText } from '../profileModel'

export function CancelCloneDialog({
  open,
  onOpenChange,
  percent,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  percent: number
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('clone.cancelDialog.title')}
      description={t('clone.cancelDialog.description', { percent })}
      confirmLabel={t('clone.actions.cancel')}
      cancelLabel={t('clone.cancelDialog.keepCloning')}
      tone="warn"
      onConfirm={onConfirm}
    />
  )
}

export interface CloneFailedDialogProps {
  status: Extract<CloneStatus, { state: 'failed' }> | undefined
  open: boolean
  onClose: () => void
  onRetry: () => void
  onUseLocalModel: (() => void) | undefined
  onWidenRange: () => void
}

export function CloneFailedDialog({
  status,
  open,
  onClose,
  onRetry,
  onUseLocalModel,
  onWidenRange,
}: CloneFailedDialogProps) {
  const t = useT()
  if (!status) return null
  const tooFew = status.kind === 'too_few_messages'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          icon={Bot}
          tone="danger"
          title={tooFew ? t('clone.failedDialog.profileFailed') : failureTitle(status.kind)}
          description={status.error}
        />
        <DialogBody>
          <p className="text-caption text-fg-2">
            {tooFew
              ? t('clone.failedDialog.tooFewHint')
              : status.kind === 'model'
                ? t('clone.failedDialog.modelHint')
                : t('clone.failedDialog.unknownHint')}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          {tooFew ? (
            <Button variant="primary" onClick={onWidenRange}>
              {t('clone.failedDialog.widenRange')}
            </Button>
          ) : (
            <>
              {onUseLocalModel ? (
                <Button variant="ghost" onClick={onUseLocalModel}>
                  {t('clone.failedDialog.useLocalModel')}
                </Button>
              ) : null}
              <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
                {t('common.retry')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface RecloneDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  name: string
  messageCount: number | undefined
  version: number
  onConfirm: (keepCorrections: boolean) => void
}

export function RecloneDialog({ open, onOpenChange, name, messageCount, version, onConfirm }: RecloneDialogProps) {
  const t = useT()
  const [keep, setKeep] = useState(true)
  useEffect(() => {
    if (open) setKeep(true)
  }, [open])
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={RefreshCw}
      tone="accent"
      title={t('clone.recloneDialog.title', { name })}
      description={
        messageCount
          ? t('clone.recloneDialog.descriptionWithCount', {
              n: messageCount,
              count: messageCount.toLocaleString('en-US'),
              version,
            })
          : t('clone.recloneDialog.description', { version })
      }
      confirmLabel={t('clone.actions.reclone')}
      onConfirm={() => onConfirm(keep)}
    >
      <Checkbox
        checked={keep}
        onCheckedChange={(c) => setKeep(c === true)}
        label={t('clone.recloneDialog.keepCorrections')}
      />
    </ConfirmDialog>
  )
}

export function DeleteCloneDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  name: string
  onConfirm: () => Promise<void>
}) {
  const t = useT()
  return (
    <DangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('clone.deleteDialog.title', { name })}
      description={deleteImpactText()}
      onConfirm={onConfirm}
    />
  )
}
