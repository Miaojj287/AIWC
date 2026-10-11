/**
 * QuestionCard — the agent's `ask_user` question. Like the approval card it takes the composer's place while the turn
 * waits (the draft stays mounted underneath, hidden): the question, 2–5 numbered options and, when the agent allows
 * it, 其他 with a text field. Digits pick at once (其他 moves into its field); ↑↓ move the selection; ⏎ confirms;
 * Esc answers 不回答 and the agent proceeds on its own judgement. Keys act only while focus is inside the card or
 * nowhere at all, so typing elsewhere is never taken as an answer. The waiting time does not count toward the turn's
 * time limit (kernel).
 */
import { Info, MessageCircleQuestion } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { QuestionAnswer } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, cn, ICON_STROKE, Input } from '@/kit'
import { APPROVAL_SCOPE_ATTR } from './ApprovalCard'
import type { QuestionRequest } from './turnSignals'

const TYPING_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CONTROL_SELECTOR = `button, a[href], [role="button"], ${TYPING_SELECTOR}`
const OTHER_MAX_CHARS = 2_000

const isUnfocused = (node: EventTarget | null): boolean => node === null || node === document.body

export interface QuestionCardProps {
  request: QuestionRequest
  onAnswer: (questionId: string, answer: QuestionAnswer) => void
  /** More questions of the thread waiting behind this one. */
  queued?: number
  className?: string
}

export function QuestionCard({ request, onAnswer, queued = 0, className }: QuestionCardProps) {
  const t = useT()
  const count = request.options.length + (request.allowOther ? 1 : 0)
  const otherIndex = request.allowOther ? request.options.length : -1
  const [selected, setSelected] = useState(0)
  const [other, setOther] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const otherRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const optionIdBase = useId()
  const optionId = (i: number) => `${optionIdBase}-${i}`
  const otherText = other.trim()

  const answer = (a: QuestionAnswer): void => onAnswer(request.questionId, a)
  const choose = (i: number): void => {
    if (i === otherIndex) {
      setSelected(i)
      if (otherText) answer({ kind: 'other', text: otherText })
      else otherRef.current?.focus()
      return
    }
    const option = request.options[i]
    if (option) answer({ kind: 'option', index: i, label: option.label })
  }

  // Take focus when it is nowhere or was left in the slot we now occupy (the hidden composer).
  useEffect(() => {
    const active = document.activeElement
    const scope = cardRef.current?.closest(`[${APPROVAL_SCOPE_ATTR}]`)
    if (isUnfocused(active) || (active && scope?.contains(active))) listRef.current?.focus()
  }, [])

  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
    const card = cardRef.current
    const target = e.target instanceof Element ? e.target : null
    const inside = Boolean(card && target && card.contains(target))
    if (!inside && !isUnfocused(e.target)) return
    if (target?.matches(TYPING_SELECTOR)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      answer({ kind: 'dismissed' })
      return
    }
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1
      if (i >= count) return
      e.preventDefault()
      choose(i)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
      return
    }
    if (e.key !== 'Enter') return
    const control = inside ? target?.closest(CONTROL_SELECTOR) : null
    if (control && card?.contains(control)) return
    e.preventDefault()
    choose(selected)
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const confirmDisabled = selected === otherIndex && !otherText

  return (
    <div
      ref={cardRef}
      role="group"
      aria-labelledby={titleId}
      data-testid="question-card"
      className={cn('flex w-full flex-col gap-3 rounded-card border border-line-10 bg-content p-3', className)}
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className="mt-[3px] shrink-0 text-accent"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption font-medium text-fg-3">{t('agent.question.heading')}</span>
          <span id={titleId} className="break-words text-body font-medium leading-5 text-fg select-text">
            {request.question}
          </span>
        </div>
        {queued > 0 ? (
          <span className="shrink-0 text-caption text-fg-3">{t('agent.question.queued', { n: queued })}</span>
        ) : null}
      </div>

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label={t('agent.question.options')}
        aria-activedescendant={optionId(selected)}
        className="flex flex-col gap-0.5 rounded-item outline-none"
      >
        {request.options.map((option, i) => (
          <QuestionOption
            key={`${i}-${option.label}`}
            id={optionId(i)}
            index={i}
            selected={i === selected}
            label={option.label}
            description={option.description}
            onClick={() => (i === selected ? choose(i) : setSelected(i))}
          />
        ))}
        {request.allowOther ? (
          <QuestionOption
            id={optionId(otherIndex)}
            index={otherIndex}
            selected={selected === otherIndex}
            label={t('agent.question.other')}
            description={t('agent.question.otherHint')}
            onClick={() => choose(otherIndex)}
          />
        ) : null}
      </div>

      {request.allowOther && selected === otherIndex ? (
        <Input
          ref={otherRef}
          size="sm"
          autoFocus
          value={other}
          maxLength={OTHER_MAX_CHARS}
          placeholder={t('agent.question.otherPlaceholder')}
          aria-label={t('agent.question.other')}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && otherText) {
              e.preventDefault()
              answer({ kind: 'other', text: otherText })
            } else if (e.key === 'Escape') {
              e.preventDefault()
              listRef.current?.focus()
            }
          }}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <Info size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3" title={t('agent.question.keyHint')}>
          {t('agent.question.keyHint')}
        </span>
        <Button size="sm" variant="ghost" onClick={() => answer({ kind: 'dismissed' })}>
          {t('agent.question.skip')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          aria-keyshortcuts="Enter"
          disabled={confirmDisabled}
          disabledReason={confirmDisabled ? t('agent.question.otherEmpty') : undefined}
          onClick={() => choose(selected)}
        >
          {t('agent.question.confirm')}
        </Button>
      </div>
    </div>
  )
}

function QuestionOption(props: {
  id: string
  index: number
  selected: boolean
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      aria-keyshortcuts={String(props.index + 1)}
      onClick={props.onClick}
      className={cn(
        'flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-item px-3 py-1.5 text-body',
        props.selected ? 'bg-selected ring-1 ring-inset ring-selected-ring' : 'hover:bg-hover-5',
      )}
    >
      <span
        className={cn('w-4 shrink-0 font-latin font-medium tabular-nums', props.selected ? 'text-fg' : 'text-fg-3')}
      >
        {props.index + 1}.
      </span>
      <span className="min-w-0 shrink truncate font-medium text-fg" title={props.label}>
        {props.label}
      </span>
      {props.description ? (
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3" title={props.description}>
          {props.description}
        </span>
      ) : null}
    </div>
  )
}
