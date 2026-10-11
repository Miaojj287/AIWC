/**
 * The composer's attachment pieces, kept out of Composer.tsx: the tiles with their inline problem / warning lines,
 * and the ＋ menu (add @ context, pick images or files).
 */
import { AtSign, Paperclip, Plus } from 'lucide-react'
import type { DraftAttachment } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  InlineHint,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { AttachmentList } from './AttachmentList'
import type { AttachmentInput } from './useAttachmentInput'

export interface ComposerAttachmentsProps {
  input: AttachmentInput
  attachments: readonly DraftAttachment[]
  onChange: (attachments: DraftAttachment[]) => void
  /** e.g. the chosen model cannot see images. */
  warning?: string
}

export function ComposerAttachments({ input, attachments, onChange, warning }: ComposerAttachmentsProps) {
  return (
    <>
      <AttachmentList
        attachments={attachments}
        onRemove={(a) => {
          input.clearError()
          onChange(attachments.filter((x) => x.id !== a.id))
        }}
      />
      {input.error ? <InlineHint kind="error">{input.error}</InlineHint> : null}
      {warning ? (
        <InlineHint kind="warning" live={false}>
          {warning}
        </InlineHint>
      ) : null}
      {input.fileInput}
    </>
  )
}

/** ＋ in the toolbar: add @ context (when mentions are on), or pick images / files. */
export function AddMenu({
  disabled,
  onAddContext,
  onPickFiles,
}: {
  disabled: boolean
  onAddContext?: () => void
  onPickFiles: () => void
}) {
  const t = useT()
  const items: MenuSpec = [
    ...(onAddContext
      ? [{ id: 'context', label: t('agent.composer.addContext'), icon: AtSign, shortcut: '@', onSelect: onAddContext }]
      : []),
    {
      id: 'files',
      label: t('agent.attachments.pick'),
      description: t('agent.attachments.pickDescription'),
      icon: Paperclip,
      onSelect: onPickFiles,
    },
  ]
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={t('agent.composer.add')}>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Plus} label={t('agent.composer.add')} disabled={disabled} className="text-fg-3" />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
