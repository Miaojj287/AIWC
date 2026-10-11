/**
 * Queued messages, shown right above the composer while there are any (queuedInputs.ts). Each row: the message text
 * (or its attachment count), and on hover / focus 立即发送 · 放回输入框编辑 · 移除. When the last turn stopped early the
 * header says the queue is on hold.
 */
import { ArrowUp, ListEnd, Pencil, X } from 'lucide-react'
import { useT } from '@/i18n'
import { ICON_STROKE, IconButton, Tooltip } from '@/kit'
import type { QueuedInput } from '../queuedInputs'

export interface QueuedInputListProps {
  items: readonly QueuedInput[]
  held: boolean
  onSendNow: (item: QueuedInput) => void
  onEdit: (item: QueuedInput) => void
  onRemove: (item: QueuedInput) => void
}

export function QueuedInputList({ items, held, onSendNow, onEdit, onRemove }: QueuedInputListProps) {
  const t = useT()
  if (items.length === 0) return null
  return (
    <section
      aria-label={t('agent.queue.label')}
      data-testid="queued-inputs"
      className="mb-2 flex flex-col gap-0.5 rounded-card border border-line-8 bg-panel p-1.5"
    >
      <div className="flex min-h-6 items-center gap-2 px-1.5 text-caption text-fg-3">
        <span className="min-w-0 truncate">{t('agent.queue.title', { n: items.length })}</span>
        {held ? <span className="min-w-0 truncate text-warn-ink">{t('agent.queue.paused')}</span> : null}
      </div>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((item) => {
          const text = item.draft.text.trim()
          const files = item.draft.attachments?.length ?? 0
          const label = text || t('agent.queue.attachments', { n: files })
          return (
            <li
              key={item.id}
              className="group/queued flex min-h-8 items-center gap-2 rounded-item px-1.5 hover:bg-hover-5 focus-within:bg-hover-5"
            >
              <ListEnd size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
              <span className="min-w-0 flex-1 truncate text-body text-fg-2" title={label}>
                {label}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/queued:opacity-100 group-focus-within/queued:opacity-100">
                <Tooltip content={t('agent.queue.sendNow')}>
                  <IconButton
                    size="sm"
                    icon={ArrowUp}
                    label={t('agent.queue.sendNow')}
                    onClick={() => onSendNow(item)}
                  />
                </Tooltip>
                <Tooltip content={t('agent.queue.edit')}>
                  <IconButton size="sm" icon={Pencil} label={t('agent.queue.edit')} onClick={() => onEdit(item)} />
                </Tooltip>
                <Tooltip content={t('agent.queue.remove')}>
                  <IconButton size="sm" icon={X} label={t('agent.queue.remove')} onClick={() => onRemove(item)} />
                </Tooltip>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
