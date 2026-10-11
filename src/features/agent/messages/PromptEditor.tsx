/**
 * In-place editor of a sent prompt (编辑): the bubble turns into a text box with 取消 / 发送. Sending rewinds the
 * conversation to this turn and runs the edited prompt (the old answer leaves the context). Enter sends, ⇧Enter is a
 * new line, Esc cancels; attachments and @ chips of the prompt are kept (chips can be removed here).
 */
import { useState } from 'react'
import type { Mention } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Chip, Textarea } from '@/kit'

/** Rows the editor grows to before it scrolls. */
const MAX_EDITOR_ROWS = 12

export interface PromptEditorProps {
  text: string
  mentions: Mention[]
  /** Every edit of the text or chips (the owner keeps them, so they outlive this editor). */
  onChange?: (text: string, mentions: Mention[]) => void
  onCancel: () => void
  onSubmit: (text: string, mentions: Mention[]) => void
}

export function PromptEditor({
  text: initial,
  mentions: initialMentions,
  onChange,
  onCancel,
  onSubmit,
}: PromptEditorProps) {
  const t = useT()
  const [text, setTextState] = useState(initial)
  const [mentions, setMentionsState] = useState(initialMentions)
  const setText = (next: string) => {
    setTextState(next)
    onChange?.(next, mentions)
  }
  const setMentions = (next: Mention[]) => {
    setMentionsState(next)
    onChange?.(text, next)
  }
  const empty = !text.trim() && mentions.length === 0
  const submit = () => {
    if (!empty) onSubmit(text, mentions)
  }
  return (
    <div className="flex w-full flex-col items-end gap-2" data-item="user-edit">
      <div className="flex w-full max-w-full flex-col gap-2 rounded-card rounded-tr-sm border border-line-8 bg-raised p-2 @min-[624px]/conversation:max-w-[576px]">
        {mentions.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pt-1">
            {mentions.map((m) => (
              <Chip
                key={`${m.kind}:${m.id}`}
                variant="mention"
                label={m.label}
                onRemove={() => setMentions(mentions.filter((x) => x !== m))}
              />
            ))}
          </div>
        ) : null}
        <Textarea
          autoFocus
          autosize
          minRows={2}
          maxRows={MAX_EDITOR_ROWS}
          value={text}
          aria-label={t('agent.stream.edit.label')}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="text-bubble leading-6"
        />
        <p className="m-0 px-1 text-caption text-fg-3">{t('agent.stream.edit.hint')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={empty}
          disabledReason={t('agent.stream.edit.empty')}
          onClick={submit}
        >
          {t('agent.stream.edit.send')}
        </Button>
      </div>
    </div>
  )
}
