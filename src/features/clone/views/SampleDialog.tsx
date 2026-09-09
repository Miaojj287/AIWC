/**
 * 先看看样本对话 — random messages from the contact (clone:sampleMessages) rendered as a small
 * transcript, with 换一批 and 开始克隆 (board 153:415 ②).
 */
import { Bot, MessageSquare, RefreshCw } from 'lucide-react'
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
  const samples = useInvoke('clone:sampleMessages', { contactId, limit: 8 }, [contactId, open], { enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={MessageSquare} tone="accent" title={`${name} · 样本对话`} description="从聊天记录中随机抽取，克隆会学习这些语气与用词" />
        <DialogBody className="max-h-[46vh]">
          {samples.loading && !samples.data ? (
            <EmptyState compact variant="loading" title="抽取样本…" />
          ) : samples.error ? (
            <EmptyState compact variant="error" title="读取失败" description={samples.error.message} action={{ label: '重试', onClick: samples.reload }} />
          ) : (samples.data ?? []).length === 0 ? (
            <EmptyState compact variant="empty" title="没有可用的文本消息" description="语音与图片不作为样本" />
          ) : (
            <div className="flex flex-col gap-3 py-1">
              {(samples.data ?? []).map((m) => (
                <div key={m.id} className="flex items-end gap-2">
                  <Avatar id={m.senderId} name={m.senderName ?? name} size={20} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-micro text-fg-3">
                      {m.senderName ?? name} {formatClock(m.createdAt)}
                    </span>
                    <div className="max-w-[320px] rounded-item rounded-bl-sm bg-panel px-3 py-1.5 text-bubble leading-[22px] text-fg">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="link" icon={RefreshCw} onClick={samples.reload} disabled={samples.loading}>
            换一批
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button variant="primary" icon={Bot} onClick={onStart}>
              开始克隆
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
