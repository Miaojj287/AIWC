/**
 * Composer — the Agent input card: mention chips, autosize textarea (40–160px at the panel width), toolbar
 * (＋ add context, then permission / context ring / model supplied by the parent) and the send / stop button.
 * `@` (or ＋) opens the mention popover, `/` the skills popover; ↑↓ ↵ esc drive them from the textarea. Both work
 * with a Chinese input method: `@` right after Chinese text triggers, and 、 typed first becomes `/`.
 * ↵ sends, ⇧↵ newline (or ⌘↵ / Ctrl+Enter sends — composer/sendKeys.ts). With an empty draft ↑ / ↓ step through
 * earlier prompts; Esc stops a running turn. While the agent works the draft stays editable: sending then steers the
 * running turn, ⌥↵ (or the queue button) queues it for when the turn ends. With `onAttachmentsChange`, images and files
 * come in by paste, drop or the ＋ menu, and a long paste becomes a text attachment (composer/useAttachmentInput.tsx).
 * Reused by the clone page.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { ComposerSendKey, DraftAttachment, Mention, MentionKind, SkillSummary } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { ListPlus, Plus } from 'lucide-react'
import { cn, IconButton, Popover, PopoverAnchor, PopoverContent, Textarea, Tooltip } from '@/kit'
import { detectMac } from '@/app/shortcuts'
import {
  addMention,
  applyTrigger,
  detectTrigger,
  insertMentionTrigger,
  matchesQuery,
  normalizeSlashKey,
  removeMention,
  stepPromptHistory,
  type Trigger,
} from './mentions'
import { MENTION_TABS, type MentionCandidate, type MentionSources } from './mentionSources'
import { MentionChips } from './messages/mentionChips'
import { SendButton } from './composer/SendButton'
import { MentionList, optionId, SkillList } from './composer/TriggerPopover'
import { AddMenu, ComposerAttachments } from './composer/ComposerAttachments'
import { composerKeyAction, queueKeyLabel, sendKeyLabel } from './composer/sendKeys'
import { useAttachmentInput } from './composer/useAttachmentInput'

export interface ComposerProps {
  value: string
  onValueChange: (text: string) => void
  mentions: Mention[]
  onMentionsChange: (mentions: Mention[]) => void
  /** Send the current draft (the parent owns value / mentions). */
  onSubmit: () => void
  /** Stop the running turn (the send button shows a square while `streaming` with an empty draft; Esc). */
  onStop?: () => void
  /** Earlier prompts of the thread, oldest first: ↑ / ↓ in an empty draft step through them. */
  history?: readonly string[]
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
  /** Images / files of the draft; with onAttachmentsChange enables paste, drop and the ＋ menu's file picker. */
  attachments?: DraftAttachment[]
  onAttachmentsChange?: (attachments: DraftAttachment[]) => void
  /** Shown under the attachments as a warning (e.g. the chosen model cannot see images). */
  attachmentWarning?: string
  /** Which key sends (设置 › 常规 › 发送消息); default ↵. */
  sendKey?: ComposerSendKey
  /** Queue the draft for when the running turn ends (⌥↵ and the queue button while streaming). */
  onQueue?: () => void
  /** Bump to move focus into the textarea (caret at the end). */
  focusSeq?: number
  autoFocus?: boolean
  maxRows?: number
  className?: string
  'data-testid'?: string
}

export const COMPOSER_PLACEHOLDER_KEY: MessageKey = 'agent.composer.placeholder'

export function Composer({
  value,
  onValueChange,
  mentions,
  onMentionsChange,
  onSubmit,
  onStop,
  history,
  streaming = false,
  disabled = false,
  placeholder,
  mentionSources,
  skills,
  toolbarLeft,
  toolbarRight,
  attachments,
  onAttachmentsChange,
  attachmentWarning,
  sendKey = 'enter',
  onQueue,
  focusSeq,
  autoFocus = false,
  maxRows = 8,
  className,
  ...rest
}: ComposerProps) {
  const t = useT()
  // Per instance: the clone page mounts its own Composer next to the Agent panel's.
  const listboxId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | undefined>(undefined)
  const [trigger, setTrigger] = useState<Trigger | undefined>(undefined)
  const suppressed = useRef<{ kind: Trigger['kind']; start: number } | undefined>(undefined)
  const [mentionKind, setMentionKind] = useState<MentionKind>('session')
  const [candidates, setCandidates] = useState<MentionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // Set by ↑ / ↓ only: a hover also moves the highlight, and scrolling under the pointer would run away.
  const revealActive = useRef(false)
  // Which earlier prompt ↑ / ↓ is showing; any edit ends browsing.
  const historyIndex = useRef<number | undefined>(undefined)

  const mentionsEnabled = Boolean(mentionSources)
  const attachmentInput = useAttachmentInput(attachments, onAttachmentsChange)
  const mac = useMemo(() => detectMac(), [])
  const skillsEnabled = Boolean(skills && skills.length > 0)

  const isOpen =
    trigger !== undefined &&
    ((trigger.kind === 'mention' && mentionsEnabled) || (trigger.kind === 'skill' && skillsEnabled))
  const skillMatches = useMemo(
    () =>
      trigger?.kind === 'skill' && skills
        ? skills.filter((s) => matchesQuery(trigger.query, s.command, s.name, s.description))
        : [],
    [skills, trigger],
  )
  const listLength = trigger?.kind === 'skill' ? skillMatches.length : candidates.length

  /* ---- trigger detection ------------------------------------------------------------- */
  const syncTrigger = useCallback((text: string, caret: number) => {
    const next = detectTrigger(text, caret)
    if (next && suppressed.current && suppressed.current.kind === next.kind && suppressed.current.start === next.start)
      return setTrigger(undefined)
    if (!next) suppressed.current = undefined
    setTrigger((prev) =>
      prev &&
      next &&
      prev.kind === next.kind &&
      prev.start === next.start &&
      prev.query === next.query &&
      prev.end === next.end
        ? prev
        : next,
    )
  }, [])

  const close = (suppress = true) => {
    if (suppress && trigger) suppressed.current = { kind: trigger.kind, start: trigger.start }
    setTrigger(undefined)
  }

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    historyIndex.current = undefined
    const next = e.target.value
    const caret = e.target.selectionStart ?? next.length
    // 、 typed first with Chinese punctuation on is the `/` key: open the skills list instead.
    const slash =
      skillsEnabled && !(e.nativeEvent as InputEvent).isComposing ? normalizeSlashKey(value, next, caret) : undefined
    if (slash) {
      onValueChange(slash.text)
      placeCaret(slash.caret)
      syncTrigger(slash.text, slash.caret)
      return
    }
    onValueChange(next)
    syncTrigger(next, caret)
  }

  /* ---- candidates ------------------------------------------------------------------- */
  useEffect(() => {
    if (!trigger || trigger.kind !== 'mention' || !mentionSources) {
      setCandidates([])
      setLoading(false)
      return
    }
    // A newer trigger (or unmount) cancels this run, so a slow search can never overwrite fresher results.
    let cancelled = false
    setCandidates([])
    setLoading(true)
    const timer = setTimeout(() => {
      mentionSources
        .search(mentionKind, trigger.query)
        .then((items) => {
          if (cancelled) return
          setCandidates(items)
          setActiveIndex(0)
        })
        .catch(() => {
          if (!cancelled) setCandidates([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trigger, mentionKind, mentionSources])

  useEffect(() => {
    setActiveIndex(0)
  }, [trigger?.query, trigger?.kind, mentionKind])
  // Focus stays in the textarea, so the list is scrolled here to keep the keyboard highlight in view.
  useEffect(() => {
    if (!revealActive.current) return
    revealActive.current = false
    document.getElementById(optionId(listboxId, activeIndex))?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, listboxId])

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

  /** ＋: type `@` at the caret, which opens the mention popover. */
  const addContext = () => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? value.length
    const next = insertMentionTrigger(value, caret)
    suppressed.current = undefined
    onValueChange(next.text)
    placeCaret(next.caret)
    syncTrigger(next.text, next.caret)
  }

  /* ---- keyboard ----------------------------------------------------------------------- */
  const hasDraft = value.trim().length > 0 || mentions.length > 0 || Boolean(attachments?.length)
  const canQueue = Boolean(onQueue) && streaming && hasDraft && !disabled
  const canSend = !disabled && hasDraft

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME confirm: some engines fire the Enter keydown after compositionend with isComposing=false, and only
    // the legacy keyCode 229 still marks it (covered by Composer.test "does not send while confirming Chinese input").
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (isOpen && trigger) {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault()
          if (listLength === 0) return
          const next = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + listLength) % listLength
          if (next === activeIndex) return
          revealActive.current = true
          setActiveIndex(next)
          return
        }
        case 'Tab':
          if (trigger.kind === 'mention') {
            e.preventDefault()
            const idx = MENTION_TABS.findIndex((tab) => tab.value === mentionKind)
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
    if (e.key === 'Escape' && streaming && onStop) {
      e.preventDefault()
      onStop()
      return
    }
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      history &&
      (value === '' || historyIndex.current !== undefined)
    ) {
      const step = stepPromptHistory(history, historyIndex.current, e.key === 'ArrowUp' ? 'older' : 'newer')
      if (!step) return
      e.preventDefault()
      historyIndex.current = step.index
      onValueChange(step.text)
      placeCaret(step.text.length)
      return
    }
    const action = composerKeyAction(e, { sendKey, mac, streaming, canQueue })
    if (!action) return
    e.preventDefault()
    if (action === 'queue') {
      historyIndex.current = undefined
      onQueue?.()
    } else if (canSend) {
      historyIndex.current = undefined
      onSubmit()
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
            'relative flex w-full flex-col gap-3 rounded-card border border-line-10 bg-content p-3 transition-colors',
            // A pointer focus (or the focus request on entering a thread) only firms up the neutral border; the accent
            // edge is for Tab navigation (kit-field, accessibility.css), so an idle composer never glows blue.
            'kit-field hover:border-(--line-16) focus-within:border-(--line-25) focus-within:hover:border-(--line-25)',
            disabled && 'opacity-60',
            attachmentInput?.dragging && 'border-accent bg-accent-12',
            className,
          )}
          onMouseDown={(e) => {
            // clicking the card's padding keeps focus in the textarea
            if (e.target === e.currentTarget) {
              e.preventDefault()
              textareaRef.current?.focus()
            }
          }}
          {...attachmentInput?.dropProps}
          data-dragging={attachmentInput?.dragging || undefined}
        >
          <MentionChips
            mentions={mentions}
            onRemove={(m) => onMentionsChange(removeMention(mentions, m))}
            className="flex flex-wrap items-center gap-1.5"
          />
          {attachmentInput && onAttachmentsChange ? (
            <ComposerAttachments
              input={attachmentInput}
              attachments={attachments ?? []}
              onChange={onAttachmentsChange}
              warning={attachmentWarning}
            />
          ) : null}
          <Textarea
            ref={textareaRef}
            aria-label={t('agent.composer.inputLabel')}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onPaste={attachmentInput?.onPaste}
            onClick={(e) => {
              const el = e.currentTarget
              syncTrigger(el.value, el.selectionStart ?? el.value.length)
            }}
            placeholder={placeholder ?? t(COMPOSER_PLACEHOLDER_KEY)}
            disabled={disabled}
            autoFocus={autoFocus}
            autosize
            minRows={2}
            maxRows={maxRows}
            spellCheck={false}
            // While `@` / `/` suggestions are open the field is a combobox over that listbox; otherwise a plain textbox.
            role={isOpen ? 'combobox' : undefined}
            aria-haspopup={isOpen ? 'listbox' : undefined}
            aria-autocomplete={isOpen ? 'list' : undefined}
            aria-expanded={isOpen || undefined}
            aria-controls={isOpen ? listboxId : undefined}
            aria-activedescendant={isOpen && listLength > 0 ? optionId(listboxId, activeIndex) : undefined}
            // The card is the field: its border shows focus, so the kit textarea's own border and keyboard edge are off
            // (`shadow-none!` must beat the unlayered kit-field rule, or Tab would draw a second ring inside the card).
            className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-bubble leading-5 text-fg shadow-none! hover:border-0 focus:border-0 focus:ring-0 focus:hover:border-0"
            wrapperClassName="gap-0"
          />
          <div className="flex items-center gap-1">
            {attachmentInput ? (
              <AddMenu
                disabled={disabled}
                onAddContext={mentionsEnabled ? addContext : undefined}
                onPickFiles={attachmentInput.pickFiles}
              />
            ) : mentionsEnabled ? (
              <Tooltip content={t('agent.composer.addContext')} kbd="@">
                <IconButton
                  icon={Plus}
                  label={t('agent.composer.addContext')}
                  disabled={disabled}
                  onClick={addContext}
                  className="text-fg-3"
                />
              </Tooltip>
            ) : null}
            {toolbarLeft}
            <span className="min-w-0 flex-1" />
            {toolbarRight}
            {canQueue ? (
              <Tooltip content={t('agent.queue.add')} kbd={queueKeyLabel(mac)} side="top">
                <IconButton icon={ListPlus} label={t('agent.queue.add')} onClick={onQueue} className="text-fg-2" />
              </Tooltip>
            ) : null}
            <SendButton
              sendKey={sendKeyLabel(sendKey, mac)}
              mode={streaming && !hasDraft ? 'stop' : 'send'}
              disabled={!canSend}
              steer={streaming}
              onSend={() => {
                historyIndex.current = undefined
                onSubmit()
              }}
              onStop={onStop}
            />
          </div>
        </div>
      </PopoverAnchor>
      {isOpen && trigger ? (
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className={cn('w-[320px]', trigger.kind === 'skill' ? 'p-1.5' : 'p-3')}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {trigger.kind === 'skill' ? (
            <SkillList
              listboxId={listboxId}
              items={skillMatches}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onPick={pickSkill}
            />
          ) : (
            <MentionList
              listboxId={listboxId}
              kind={mentionKind}
              onKindChange={setMentionKind}
              items={candidates}
              loading={loading}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onPick={pickMention}
              query={trigger.query}
            />
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
