/**
 * Clone dialogs (board 153:415 ③④): 取消克隆 confirm, failure (模型错误 vs 有效消息过少), 重新克隆 with
 * 保留手动修正, and the danger 删除分身 confirm.
 */
import { Bot, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CloneStatus } from '@aiwc/protocol'
import { Button, Checkbox, ConfirmDialog, DangerDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/kit'
import { failureTitle } from '../cloneView'
import { deleteImpactText } from '../profileModel'

export function CancelCloneDialog({ open, onOpenChange, percent, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; percent: number; onConfirm: () => void }) {
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title="取消克隆？" description={`已完成的 ${percent}% 进度不会保留，下次需要重新开始。`} confirmLabel="取消克隆" cancelLabel="继续克隆" tone="warn" onConfirm={onConfirm} />
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

export function CloneFailedDialog({ status, open, onClose, onRetry, onUseLocalModel, onWidenRange }: CloneFailedDialogProps) {
  if (!status) return null
  const tooFew = status.kind === 'too_few_messages'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={Bot} tone="danger" title={tooFew ? '无法生成画像' : failureTitle(status.kind)} description={status.error} />
        <DialogBody>
          <p className="text-caption text-fg-2">{tooFew ? '过滤转发、链接和系统消息后有效消息不足以提炼说话风格，建议扩大训练范围。' : status.kind === 'model' ? '模型请求失败。你可以换用本地模型重试，或稍后再试。' : '稍后再试；如果持续失败，请导出日志反馈。'}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {tooFew ? (
            <Button variant="primary" onClick={onWidenRange}>
              扩大范围
            </Button>
          ) : (
            <>
              {onUseLocalModel ? (
                <Button variant="ghost" onClick={onUseLocalModel}>
                  换用本地模型
                </Button>
              ) : null}
              <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
                重试
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
      title={`重新克隆「${name}」？`}
      description={`将基于最新的${messageCount ? ` ${messageCount.toLocaleString('en-US')} 条` : ''}消息重新提炼画像，当前 v${version} 画像与你手动修正的标签会被覆盖。`}
      confirmLabel="重新克隆"
      onConfirm={() => onConfirm(keep)}
    >
      <Checkbox checked={keep} onCheckedChange={(c) => setKeep(c === true)} label="保留我手动修正的标签与样本" />
    </ConfirmDialog>
  )
}

export function DeleteCloneDialog({ open, onOpenChange, name, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; onConfirm: () => Promise<void> }) {
  return <DangerDialog open={open} onOpenChange={onOpenChange} title={`删除「${name}」的分身？`} description={deleteImpactText()} onConfirm={onConfirm} />
}
