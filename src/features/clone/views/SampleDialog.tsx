/**
 * 先看看样本对话 — random messages from the contact (clone:sampleMessages) rendered as a small
 * transcript, with 换一批 and 开始克隆 (board 153:415 ②).
 */
import { Bot, MessageSquare, RefreshCw } from 'lucide-react'
import { useT } from '@/i18n'
import { Avatar, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, EmptyState } from '@/kit'
import { formatClock } from '@/platform/format'
import { useInvoke } from '@/platform/hooks'

export interface SampleDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  contactId: string
  name: string
  onStart: () => void
}

export function SampleDialog({ open, onOpenChange, contactId, name, onStart }: SampleDialogProps) {
  const t = useT()
  const samples = useInvoke('clone:sampleMessages', { contactId, limit: 8 }, [contactId, open], { enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={MessageSquare}
          tone="accent"
          title={t('clone.sampleDialog.title', { name })}
          description={t('clone.sampleDialog.description')}
        />
        <DialogBody className="max-h-[46vh]">
          {samples.loading && !samples.data ? (
            <EmptyState compact variant="loading" title={t('clone.sampleDialog.loading')} />
          ) : samples.error ? (
            <EmptyState
              compact
              variant="error"
              title={t('clone.sampleDialog.loadFailed')}
              description={samples.error.message}
              action={{ label: t('common.retry'), onClick: samples.reload }}
            />
          ) : (samples.data ?? []).length === 0 ? (
            <EmptyState
              compact
              variant="empty"
              title={t('clone.sampleDialog.empty')}
              description={t('clone.sampleDialog.emptyHint')}
            />
          ) : (
            <div className="flex flex-col gap-3 py-1">
              {(samples.data ?? []).map((m) => (
                <div key={m.id} className="flex items-end gap-2">
                  <Avatar id={m.senderId} name={m.senderName ?? name} size={20} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-micro text-fg-3">
                      {m.senderName ?? name} {formatClock(m.createdAt)}
                    </span>
                    <div className="max-w-[320px] rounded-item rounded-bl-sm bg-panel px-3 py-1.5 text-bubble leading-[22px] text-fg">
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="link" icon={RefreshCw} onClick={samples.reload} disabled={samples.loading}>
            {t('clone.sampleDialog.shuffle')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            <Button variant="primary" icon={Bot} onClick={onStart}>
              {t('clone.actions.start')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
