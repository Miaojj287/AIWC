/**
 * Composer — the Agent input card (Figma 150:585): mention chips, autosize textarea, toolbar
 * (permission / model / context ring supplied by the parent) and the four-state send button.
 * `@` opens the mention popover, `/` the skills popover; ↑↓ ↵ esc drive them from the textarea.
 * ↵ sends, ⇧↵ newline, ⌘↵ sends. Reused by the clone page with its own toolbar / sources.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { Mention, MentionKind, SkillSummary } from '@aiwc/protocol'
import { cn, Popover, PopoverAnchor, PopoverContent, Textarea } from '@/kit'
import { addMention, applyTrigger, detectTrigger, matchesQuery, removeMention, type Trigger } from './mentions'
import { MENTION_TABS, type MentionCandidate, type MentionSources } from './mentionSources'
import { MentionChips } from './messages/mentionChips'
import { SendButton } from './composer/SendButton'
import { MentionList, SkillList } from './composer/TriggerPopover'

export interface ComposerProps {
  value: string
  onValueChange: (text: string) => void
  mentions: Mention[]
  onMentionsChange: (mentions: Mention[]) => void
  /** Send the current draft (the parent owns value / mentions). */
  onSubmit: () => void
  /** Stop the running turn (send button shows a square while `streaming`). */
  onStop?: () => void
  streaming?: boolean
  disabled?: boolean
  placeholder?: string
  /** Enables `@`; omit to disable mentions. */
  mentionSources?: MentionSources
  /** Enables `/`; omit or pass [] to disable skills. */
  skills?: SkillSummary[]
  /** Toolbar left of the spacer (permission mode). */
  toolbarLeft?: ReactNode
  /** Toolbar right of the spacer, before the send button (context ring, model). */
  toolbarRight?: ReactNode
  /** Bump to move focus into the textarea (caret at the end). */
  focusSeq?: number
  autoFocus?: boolean
  maxRows?: number
  className?: string
  'data-testid'?: string
}

export const COMPOSER_PLACEHOLDER = '今天帮你做些什么？ @ 引用对话，/ 调用技能'

export function Composer({
  value,
  onValueChange,
  mentions,
  onMentionsChange,
  onSubmit,
  onStop,
  streaming = false,
  disabled = false,
  placeholder = COMPOSER_PLACEHOLDER,
  mentionSources,
  skills,
  toolbarLeft,
  toolbarRight,
  focusSeq,
  autoFocus = false,
  maxRows = 8,
  className,
  ...rest
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | undefined>(undefined)
  const [trigger, setTrigger] = useState<Trigger | undefined>(undefined)
  const suppressed = useRef<{ kind: Trigger['kind']; start: number } | undefined>(undefined)
  const [mentionKind, setMentionKind] = useState<MentionKind>('session')
  const [candidates, setCandidates] = useState<MentionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const requestSeq = useRef(0)

  const mentionsEnabled = Boolean(mentionSources)
  const skillsEnabled = Boolean(skills && skills.length > 0)

  const isOpen = trigger !== undefined && ((trigger.kind === 'mention' && mentionsEnabled) || (trigger.kind === 'skill' && skillsEnabled))
  const skillMatches = useMemo(() => (trigger?.kind === 'skill' && skills ? skills.filter((s) => matchesQuery(trigger.query, s.command, s.name, s.description)) : []), [skills, trigger])
  const listLength = trigger?.kind === 'skill' ? skillMatches.length : candidates.length

  /* ---- trigger detection ------------------------------------------------------------- */
  const syncTrigger = useCallback(
    (text: string, caret: number) => {
      const next = detectTrigger(text, caret)
      if (next && suppressed.current && suppressed.current.kind === next.kind && suppressed.current.start === next.start) return setTrigger(undefined)
      if (!next) suppressed.current = undefined
      setTrigger((prev) => (prev && next && prev.kind === next.kind && prev.start === next.start && prev.query === next.query && prev.end === next.end ? prev : next))
    },
    [],
  )

  const close = (suppress = true) => {
    if (suppress && trigger) suppressed.current = { kind: trigger.kind, start: trigger.start }
    setTrigger(undefined)
  }

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onValueChange(e.target.value)
    syncTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length)
  }

  /* ---- candidates ------------------------------------------------------------------- */
  useEffect(() => {
    const seq = ++requestSeq.current
    if (!trigger || trigger.kind !== 'mention' || !mentionSources) {
      setCandidates([])
      setLoading(false)
      return
    }
    setCandidates([])
    setLoading(true)
    const timer = setTimeout(() => {
      mentionSources
        .search(mentionKind, trigger.query)
        .then((items) => {
          if (seq !== requestSeq.current) return
          setCandidates(items)
          setActiveIndex(0)
        })
        .catch(() => {
          if (seq === requestSeq.current) setCandidates([])
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false)
        })
    }, 120)
    return () => { clearTimeout(timer); requestSeq.current++ }
  }, [trigger, mentionKind, mentionSources])

  useEffect(() => {
    setActiveIndex(0)
  }, [trigger?.query, trigger?.kind, mentionKind])

  /* ---- picking ------------------------------------------------------------------------ */
  const placeCaret = (caret: number) => {
    pendingCaret.current = caret
  }
  useEffect(() => {
    const caret = pendingCaret.current
    if (caret === undefined) return
    pendingCaret.current = undefined
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(caret, caret)
  }, [value])

  const pickMention = (item: MentionCandidate) => {
    if (!trigger) return
    const { text, caret } = applyTrigger(value, trigger, '')
    onMentionsChange(addMention(mentions, { kind: item.kind, id: item.id, label: item.label }))
    onValueChange(text)
    placeCaret(caret)
    close(false)
  }

  const pickSkill = (skill: SkillSummary) => {
    if (!trigger) return
    const { text, caret } = applyTrigger(value, trigger, `${skill.command} `)
    onValueChange(text)
    placeCaret(caret)
    close(false)
  }

  /* ---- keyboard ----------------------------------------------------------------------- */
  const canSend = !disabled && (value.trim().length > 0 || mentions.length > 0)

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (isOpen && trigger) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (listLength > 0) setActiveIndex((i) => (i + 1) % listLength)
          return
        case 'ArrowUp':
          e.preventDefault()
          if (listLength > 0) setActiveIndex((i) => (i - 1 + listLength) % listLength)
          return
        case 'Tab':
          if (trigger.kind === 'mention') {
            e.preventDefault()
            const idx = MENTION_TABS.findIndex((t) => t.value === mentionKind)
            const next = MENTION_TABS[(idx + (e.shiftKey ? -1 : 1) + MENTION_TABS.length) % MENTION_TABS.length]
            if (next) setMentionKind(next.value)
          }
          return
        case 'Enter':
          if (e.shiftKey) return
          e.preventDefault()
          if (trigger.kind === 'skill') {
            const s = skillMatches[activeIndex]
            if (s) pickSkill(s)
            else close()
          } else {
            if (loading) return
            const c = candidates[activeIndex]
            if (c) pickMention(c)
            else close()
          }
          return
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          close()
          return
        default:
          return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSubmit()
    }
  }

  const handleKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isOpen) return
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
      const el = e.currentTarget
      syncTrigger(el.value, el.selectionStart ?? el.value.length)
    }
  }

  /* ---- focus requests ----------------------------------------------------------------- */
  useEffect(() => {
    if (focusSeq === undefined || focusSeq === 0) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [focusSeq])

  return (
    <Popover open={isOpen} modal={false} onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        <div
          data-testid={rest['data-testid'] ?? 'composer'}
          data-streaming={streaming || undefined}
          className={cn(
            'relative flex w-full flex-col gap-2 rounded-card border border-line-10 bg-content px-3 pb-2.5 pt-3 shadow-toast transition-colors duration-(--dur-fast)',
            'focus-within:border-accent/80',
            disabled && 'opacity-60',
            className,
          )}
          onMouseDown={(e) => {
            // clicking the card's padding keeps focus in the textarea
            if (e.target === e.currentTarget) {
              e.preventDefault()
              textareaRef.current?.focus()
            }
          }}
        >
          <MentionChips mentions={mentions} onRemove={(m) => onMentionsChange(removeMention(mentions, m))} className="flex flex-wrap items-center gap-1.5" />
          <Textarea
            ref={textareaRef}
            aria-label="给 Agent 的消息"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onClick={(e) => {
              const el = e.currentTarget
              syncTrigger(el.value, el.selectionStart ?? el.value.length)
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            autosize
            minRows={2}
            maxRows={maxRows}
            spellCheck={false}
            aria-expanded={isOpen || undefined}
            aria-controls={isOpen ? 'agent-composer-popover' : undefined}
            aria-activedescendant={isOpen && listLength > 0 ? `${trigger?.kind === 'skill' ? 'skill' : 'mention'}-opt-${activeIndex}` : undefined}
            className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-body leading-5 text-fg hover:border-0 focus:border-0 focus:hover:border-0"
            wrapperClassName="gap-0"
          />
          <div className="flex items-center gap-1.5">
            {toolbarLeft}
            <span className="min-w-0 flex-1" />
            {toolbarRight}
            <SendButton mode={streaming ? 'stop' : 'send'} disabled={!canSend} onSend={onSubmit} onStop={onStop} />
          </div>
        </div>
      </PopoverAnchor>
      {isOpen && trigger ? (
        <PopoverContent
          id="agent-composer-popover"
          side="top"
          align="start"
          sideOffset={8}
          className={cn('p-3', trigger.kind === 'skill' ? 'w-[320px] p-1.5' : 'w-[300px]')}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {trigger.kind === 'skill' ? (
            <SkillList items={skillMatches} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} onPick={pickSkill} />
          ) : (
            <MentionList kind={mentionKind} onKindChange={setMentionKind} items={candidates} loading={loading} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} onPick={pickMention} query={trigger.query} />
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
