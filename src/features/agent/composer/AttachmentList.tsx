/**
 * Attachments as tiles: images as 56px thumbnails, files and long pastes as a name + size card. Shared by the composer
 * (removable: × on hover / focus, Delete / Backspace on a focused tile) and the user bubble (read-only).
 */
import { ClipboardPaste, FileText, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { DraftAttachment } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { cn, ICON_STROKE, IconButton, Tooltip } from '@/kit'
import { formatBytes, formatNumber } from '@/platform/format'
import { attachmentBytes, imagePreviewUrl } from './attachments'

export interface AttachmentListProps {
  attachments: readonly DraftAttachment[]
  /** Removable tiles (composer). */
  onRemove?: (attachment: DraftAttachment) => void
  className?: string
}

export function AttachmentList({ attachments, onRemove, className }: AttachmentListProps) {
  const t = useT()
  if (attachments.length === 0) return null
  return (
    <ul aria-label={t('agent.attachments.label')} className={cn('m-0 flex list-none flex-wrap gap-1.5 p-0', className)}>
      {attachments.map((a) => (
        <AttachmentTile key={a.id} attachment={a} onRemove={onRemove ? () => onRemove(a) : undefined} />
      ))}
    </ul>
  )
}

function AttachmentTile({ attachment, onRemove }: { attachment: DraftAttachment; onRemove?: () => void }) {
  const t = useT()
  const { part, pasted } = attachment
  const name = part.name ?? t('agent.attachments.image')
  const preview = imagePreviewUrl(part)
  const meta = pasted
    ? t('agent.attachments.pastedMeta', { chars: formatNumber(pasted.chars), lines: pasted.lines })
    : formatBytes(attachmentBytes(attachment))
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (onRemove && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      onRemove()
    }
  }
  return (
    <li className="group/attachment relative min-w-0" data-attachment={part.type}>
      <Tooltip content={`${name} · ${meta}`}>
        {preview ? (
          <img
            src={preview}
            alt={name}
            tabIndex={onRemove ? 0 : undefined}
            onKeyDown={onKeyDown}
            className="block size-14 rounded-item border border-line-8 bg-raised object-cover"
          />
        ) : (
          <div
            tabIndex={onRemove ? 0 : undefined}
            onKeyDown={onKeyDown}
            aria-label={`${name} · ${meta}`}
            className="flex h-14 w-[200px] max-w-full min-w-0 items-center gap-2 rounded-item border border-line-8 bg-raised px-2.5"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-item bg-hover-7 text-fg-2">
              {pasted ? (
                <ClipboardPaste size={16} strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <FileText size={16} strokeWidth={ICON_STROKE} aria-hidden />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
              <span className="truncate text-caption font-medium text-fg">{name}</span>
              <span className="truncate text-micro text-fg-3">{meta}</span>
            </span>
          </div>
        )}
      </Tooltip>
      {onRemove ? (
        <IconButton
          size="xs"
          icon={X}
          label={t('agent.attachments.remove', { name })}
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 rounded-chip border border-line-10 bg-overlay text-fg-2 opacity-0 group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100 focus-visible:opacity-100"
        />
      ) : null}
    </li>
  )
}
