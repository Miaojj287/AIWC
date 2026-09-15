/**
 * 人格画像 column (Figma 145:415 right, board 153:415 ④): editable 语气 / 口头禅 chips, 回复习惯 KV rows,
 * 扮演纠正 (director's notes), 样本消息 with replace / delete, and 重新提炼画像.
 * Every edit → clone:updateProfile; notes → clone:notes / clone:deleteNote.
 */
import { Check, MessageSquareWarning, Pencil, Plus, Quote, RefreshCw, Trash, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PersonaCard, PersonaNote, PersonaSample, RelationshipProfile } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Button,
  Chip,
  EmptyState,
  ICON_STROKE,
  IconButton,
  InlineHint,
  Input,
  ScrollArea,
  Textarea,
  cn,
  toast,
} from '@/kit'
import { formatNumber } from '@/platform/format'
import {
  MANUAL_SAMPLE_PROMPT,
  addTag,
  cardWithTags,
  removeAt,
  removeHabit,
  replaceSample,
  setHabit,
  type TagField,
} from '../profileModel'

export interface ProfileEditorProps {
  profile: RelationshipProfile
  messageCount: number | undefined
  /** Persist a patch (clone:updateProfile); the owner reports failures, so the result is not used here. */
  onPatch: (patch: Partial<Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>>) => Promise<unknown>
  onRefine: () => Promise<void>
  refining: boolean
  /** Director's notes distilled from the test chat; the clone obeys the corrections on every turn. */
  notes: PersonaNote[]
  onDeleteNote: (at: number) => Promise<void>
}

export function ProfileEditor({
  profile,
  messageCount,
  onPatch,
  onRefine,
  refining,
  notes,
  onDeleteNote,
}: ProfileEditorProps) {
  const t = useT()
  const card = profile.card
  const saveCard = (next: PersonaCard) => onPatch({ card: next })

  return (
    <aside className="flex h-full min-h-0 w-[260px] shrink-0 flex-col border-l border-line-6 bg-panel/40">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-body font-medium text-fg">{t('clone.profile.title')}</h2>
            <p className="text-micro text-fg-3">
              {messageCount !== undefined
                ? t('clone.profile.subtitle', { n: messageCount, count: formatNumber(messageCount) })
                : t('clone.profile.editable')}
            </p>
          </div>
          <TagSection
            title={t('clone.profile.tone')}
            field="tone"
            values={card.tone}
            onChange={(list) => saveCard(cardWithTags(card, 'tone', list))}
            placeholder={t('clone.profile.tonePlaceholder')}
          />
          <TagSection
            title={t('clone.profile.catchphrases')}
            field="catchphrases"
            values={card.catchphrases}
            onChange={(list) => saveCard(cardWithTags(card, 'catchphrases', list))}
            placeholder={t('clone.profile.catchphrasesPlaceholder')}
            tone="clone"
          />
          <TagSection
            title={t('clone.profile.traits')}
            field="traits"
            values={card.traits}
            onChange={(list) => saveCard(cardWithTags(card, 'traits', list))}
            placeholder={t('clone.profile.traitsPlaceholder')}
          />
          <HabitsSection habits={card.replyHabits} onChange={(replyHabits) => saveCard({ ...card, replyHabits })} />
          <NotesSection notes={notes} onDelete={onDeleteNote} />
          <SamplesSection samples={profile.samples} onChange={(samples) => onPatch({ samples })} />
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-line-6 px-3 py-2">
        <Button
          variant="link"
          icon={RefreshCw}
          onClick={() => void onRefine()}
          loading={refining}
          className="w-full justify-start"
        >
          {t('clone.profile.refine')}
        </Button>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------- tags */

function TagSection({
  title,
  field,
  values,
  onChange,
  placeholder,
  tone,
}: {
  title: string
  field: TagField
  values: string[]
  onChange: (list: string[]) => void
  placeholder: string
  tone?: 'clone'
}) {
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const commit = () => {
    const res = addTag(values, value)
    if (res.error) {
      if (value.trim()) setError(res.error)
      else setAdding(false)
      return
    }
    onChange(res.list)
    setValue('')
    setError(undefined)
    setAdding(false)
  }
  return (
    <Block
      title={title}
      action={
        <IconButton
          size="xs"
          icon={Plus}
          label={t('clone.profile.addTag', { field })}
          onClick={() => setAdding(true)}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && !adding ? (
          <EmptyState
            compact
            variant="empty"
            title={t('clone.profile.noTags', { field })}
            description={t('clone.profile.addHint')}
            className="w-full py-3"
          />
        ) : null}
        {values.map((t, i) => (
          <Chip
            key={`${t}-${i}`}
            variant="mention"
            label={t}
            onRemove={() => onChange(removeAt(values, i))}
            className={cn(tone === 'clone' && 'bg-clone/12 text-clone hover:bg-clone/16')}
          />
        ))}
        {adding ? (
          <Input
            size="sm"
            autoFocus
            aria-label={placeholder}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value)
              setError(undefined)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                setAdding(false)
                setValue('')
              }
            }}
            onBlur={commit}
            error={error ? true : undefined}
            wrapperClassName="w-[140px]"
          />
        ) : null}
      </div>
      {error ? <InlineHint kind="error">{error}</InlineHint> : null}
    </Block>
  )
}

/* ----------------------------------------------------------------- habits */

function HabitsSection({
  habits,
  onChange,
}: {
  habits: Record<string, string>
  onChange: (h: Record<string, string>) => void
}) {
  const t = useT()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const entries = Object.entries(habits)
  const commit = () => {
    if (editing === null) return
    onChange(setHabit(habits, editing, value))
    setEditing(null)
  }
  return (
    <Block
      title={t('clone.profile.habits')}
      action={<IconButton size="xs" icon={Plus} label={t('clone.profile.addHabit')} onClick={() => setAddingKey('')} />}
    >
      <div className="flex flex-col">
        {entries.length === 0 && addingKey === null ? (
          <EmptyState
            compact
            variant="empty"
            title={t('clone.profile.noHabits')}
            description={t('clone.profile.addHint')}
            className="py-3"
          />
        ) : null}
        {entries.map(([k, v]) => (
          <div key={k} className="group flex min-h-7 items-center gap-2 text-caption">
            <span className="max-w-[45%] shrink-0 truncate text-fg-3" title={k}>
              {k}
            </span>
            {editing === k ? (
              <Input
                size="sm"
                autoFocus
                aria-label={t('clone.profile.habitValueOf', { name: k })}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={commit}
                wrapperClassName="ml-auto w-[120px]"
              />
            ) : (
              <>
                <span className="ml-auto min-w-0 truncate text-right text-fg" title={v}>
                  {v}
                </span>
                <span className="hidden shrink-0 items-center group-hover:flex">
                  <IconButton
                    size="xs"
                    icon={Pencil}
                    label={t('clone.profile.editHabit', { name: k })}
                    onClick={() => {
                      setEditing(k)
                      setValue(v)
                    }}
                  />
                  <IconButton
                    size="xs"
                    icon={Trash}
                    label={t('clone.profile.deleteHabit', { name: k })}
                    tone="danger"
                    onClick={() => onChange(removeHabit(habits, k))}
                  />
                </span>
              </>
            )}
          </div>
        ))}
        {addingKey !== null ? (
          <div className="mt-1 flex items-center gap-1.5">
            <Input
              size="sm"
              autoFocus
              aria-label={t('clone.profile.habitName')}
              value={addingKey}
              placeholder={t('clone.profile.habitNamePlaceholder')}
              onChange={(e) => setAddingKey(e.target.value)}
              wrapperClassName="w-[96px]"
            />
            <Input
              size="sm"
              aria-label={t('clone.profile.habitValue')}
              value={value}
              placeholder={t('clone.profile.habitValuePlaceholder')}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addingKey.trim()) {
                  onChange(setHabit(habits, addingKey, value))
                  setAddingKey(null)
                  setValue('')
                }
                if (e.key === 'Escape') setAddingKey(null)
              }}
              wrapperClassName="flex-1"
            />
            <IconButton
              size="xs"
              icon={Check}
              label={t('clone.profile.confirm')}
              disabled={!addingKey.trim()}
              onClick={() => {
                onChange(setHabit(habits, addingKey, value))
                setAddingKey(null)
                setValue('')
              }}
            />
            <IconButton size="xs" icon={X} label={t('common.cancel')} onClick={() => setAddingKey(null)} />
          </div>
        ) : null}
      </div>
    </Block>
  )
}

/* ------------------------------------------------------------------ notes */

/**
 * What the user told the clone to do differently. These outrank the mined profile in the prompt, so
 * they are shown here — otherwise 「不像 TA」 would once again feel like it did nothing.
 */
function NotesSection({ notes, onDelete }: { notes: PersonaNote[]; onDelete: (at: number) => Promise<void> }) {
  const t = useT()
  const corrections = notes.filter((n) => n.kind === 'correction')
  return (
    <Block
      title={t('clone.profile.notes')}
      action={<span className="font-latin text-micro text-fg-3">{corrections.length}</span>}
    >
      <div className="flex flex-col gap-1.5">
        {corrections.length === 0 ? (
          <EmptyState
            compact
            variant="empty"
            icon={MessageSquareWarning}
            title={t('clone.profile.noNotes')}
            description={t('clone.profile.noNotesHint')}
            className="py-3"
          />
        ) : null}
        {corrections.map((n) => (
          <div
            key={n.at}
            className="group flex items-start gap-1.5 rounded-item border border-line-6 bg-content px-2.5 py-1.5"
          >
            <MessageSquareWarning
              size={11}
              strokeWidth={ICON_STROKE}
              aria-hidden
              className="mt-1 shrink-0 text-accent"
            />
            <span className="min-w-0 flex-1 text-caption leading-4 text-fg">{n.text}</span>
            <span className="hidden shrink-0 items-center group-hover:flex">
              <IconButton
                size="xs"
                icon={Trash}
                label={t('clone.profile.deleteNote')}
                tone="danger"
                onClick={() => void onDelete(n.at)}
              />
            </span>
          </div>
        ))}
      </div>
    </Block>
  )
}

/* ---------------------------------------------------------------- samples */

function SamplesSection({ samples, onChange }: { samples: PersonaSample[]; onChange: (s: PersonaSample[]) => void }) {
  const t = useT()
  const [editing, setEditing] = useState<number | null>(null)
  const [value, setValue] = useState('')
  const commit = () => {
    if (editing === null) return
    if (!value.trim()) {
      toast.warning(t('clone.profile.sampleRequired'))
      return
    }
    onChange(replaceSample(samples, editing, value, Date.now()))
    setEditing(null)
  }
  return (
    <Block
      title={t('clone.profile.samples')}
      action={<span className="font-latin text-micro text-fg-3">{samples.length}</span>}
    >
      <div className="flex flex-col gap-1.5">
        {samples.length === 0 ? (
          <EmptyState
            compact
            variant="empty"
            icon={Quote}
            title={t('clone.profile.noSamples')}
            description={t('clone.profile.noSamplesHint')}
            className="py-3"
          />
        ) : null}
        {samples.map((s, i) => (
          <div
            key={`${i}-${s.reply}`}
            className="group flex items-start gap-1.5 rounded-item border border-line-6 bg-content px-2.5 py-1.5"
          >
            <Quote size={11} strokeWidth={ICON_STROKE} aria-hidden className="mt-1 shrink-0 text-fg-3" />
            {editing === i ? (
              <Textarea
                autosize
                minRows={1}
                maxRows={4}
                autoFocus
                aria-label={t('clone.profile.replaceSample')}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commit()
                  }
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={commit}
                wrapperClassName="flex-1"
              />
            ) : (
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="text-caption leading-4 text-fg"
                    title={
                      s.prompt
                        ? t('clone.profile.samplePrompt', {
                            prompt:
                              s.prompt === MANUAL_SAMPLE_PROMPT ? t('clone.profile.manualSamplePrompt') : s.prompt,
                          })
                        : undefined
                    }
                  >
                    {s.reply}
                  </span>
                  {s.corrected ? <span className="text-micro text-accent">{t('clone.profile.corrected')}</span> : null}
                </div>
                <span className="hidden shrink-0 items-center group-hover:flex">
                  <IconButton
                    size="xs"
                    icon={RefreshCw}
                    label={t('clone.profile.replaceSample')}
                    onClick={() => {
                      setEditing(i)
                      setValue(s.reply)
                    }}
                  />
                  <IconButton
                    size="xs"
                    icon={Trash}
                    label={t('clone.profile.deleteSample')}
                    tone="danger"
                    onClick={() => onChange(removeAt(samples, i))}
                  />
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </Block>
  )
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex h-5 items-center">
        <h3 className="text-caption text-fg-3">{title}</h3>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  )
}
