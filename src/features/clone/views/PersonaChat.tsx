/**
 * 与分身试聊 (Figma 145:415 left, board 153:415 ④): a dedicated kernel thread (profile 'persona')
 * driven through agent:submit thread.create → clone:chat, rendered from 'agent:event' pushes.
 * Assistant bubbles carry the 分身 badge; hover gives 像 / 不太像 / 不像 TA (correction popover) / 复制.
 */
import { ArrowUp, Copy, MessageSquareQuote, Quote, ThumbsDown, ThumbsUp, Trash, UserRoundX } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { asThreadId, newThreadId, type ThreadId } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  IconButton,
  InlineHint,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Textarea,
  cn,
  toast,
  type MenuSpec,
} from '@/kit'
import { formatClock } from '@/platform/format'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import {
  VERDICT_LABEL,
  bubblesOf,
  initialPersonaChat,
  messagesFromHistory,
  personaChatReducer,
  type PersonaMessage,
  type Verdict,
} from '../personaChat'

export interface PersonaChatProps {
  contactId: string
  name: string
  avatarPath?: string
  /** Persisted thread id (tab.state) so re-opening the tab keeps the transcript. */
  threadId: string | undefined
  onThreadId: (id: ThreadId) => void
  /** Add a reply as a profile sample (right column); resolves false when it was not saved (already reported). */
  onSaveSample: (reply: string) => Promise<boolean>
  selfName?: string
  /** Corrections / episodes were learned from this chat — refresh the 扮演纠正 list. */
  onNotesChanged?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Do not bother reflecting on a two-line chat; the backend applies the real growth check. */
const REFLECT_AFTER_MESSAGES = 6

export function PersonaChat({
  contactId,
  name,
  avatarPath,
  threadId,
  onThreadId,
  onSaveSample,
  selfName,
  onNotesChanged,
}: PersonaChatProps) {
  const t = useT()
  const [state, dispatch] = useReducer(personaChatReducer, initialPersonaChat)
  const [text, setText] = useState('')
  /** The last text sent: the input is cleared on send, so 重试 needs its own copy. */
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [loadingThread, setLoadingThread] = useState(Boolean(threadId))
  // 清空 is destructive → second confirmation (CLAUDE.md §4.4); the menu item only opens the dialog.
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  /** Threads created in this component; their transcript is already on screen. */
  const ownThreads = useRef(new Set<string>())

  useBridgeEvent('agent:event', (e) => dispatch({ type: 'event', event: e, now: Date.now() }))

  /**
   * Restore the persisted thread's transcript; fall back to a fresh thread when unknown.
   *
   * A thread created by this component must be skipped: onThreadId() writes it into tab.state, which
   * re-runs this effect mid-turn, and the reload would replace the live transcript (including the
   * message the user just sent) with whatever the backend had recorded at that instant.
   */
  useEffect(() => {
    if (!threadId) {
      dispatch({ type: 'thread', threadId: null })
      setLoadingThread(false)
      return
    }
    if (ownThreads.current.has(threadId)) {
      setLoadingThread(false)
      return
    }
    let cancelled = false
    setLoadingThread(true)
    invoke('agent:getThread', { threadId: asThreadId(threadId) })
      .then((res) => {
        if (!cancelled)
          dispatch({ type: 'thread', threadId: asThreadId(threadId), messages: messagesFromHistory(res.items) })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'thread', threadId: null })
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false)
      })
    return () => {
      cancelled = true
    }
  }, [threadId])

  // Follow the conversation: a new message, or the last one still streaming, scrolls to the bottom.
  const messageCount = state.messages.length
  const lastMessageText = state.messages.at(-1)?.text
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messageCount, lastMessageText])

  /**
   * After a reply lands, let the backend distil what the user said about the impersonation into
   * corrections the clone must obey. Cheap to call: the main process keeps a watermark and returns
   * immediately unless the transcript actually grew (see clone:reflect).
   */
  const reflecting = useRef(false)
  useEffect(() => {
    const id = state.threadId
    if (!id || state.generating || reflecting.current || state.messages.length < REFLECT_AFTER_MESSAGES) return
    reflecting.current = true
    invoke('clone:reflect', { contactId, threadId: id })
      .then((res) => {
        if (!res.ok) return
        onNotesChanged?.()
        if (res.corrections > 0)
          toast.info(t('clone.chat.correctionsLearned', { n: res.corrections }), {
            detail: t('clone.chat.correctionsLearnedDetail', { name }),
          })
      })
      .catch(() => {
        /* reflection is an optimisation; never surface it as a chat failure */
      })
      .finally(() => {
        reflecting.current = false
      })
  }, [state.generating, state.messages.length, state.threadId, contactId, name, onNotesChanged, t])

  const ensureThread = useCallback(async (): Promise<ThreadId> => {
    if (state.threadId) return state.threadId
    const id = newThreadId()
    ownThreads.current.add(id)
    await invoke('agent:submit', {
      type: 'thread.create',
      threadId: id,
      origin: { channel: 'desktop', peerId: contactId },
      settings: {
        permissionMode: 'ask',
        profile: 'persona',
        allowAlways: [],
        title: t('clone.chat.threadTitle', { name }),
      },
    })
    dispatch({ type: 'thread', threadId: id })
    onThreadId(id)
    return id
  }, [state.threadId, contactId, name, onThreadId, t])

  /** Sends the input, or `retryText` (重试) without touching what is being typed. */
  const send = async (retryText?: string) => {
    const value = (retryText ?? text).trim()
    if (!value || state.generating) return
    if (retryText === undefined) setText('')
    setLastSent(value)
    const localId = `local_${++seq.current}`
    try {
      const id = await ensureThread()
      dispatch({ type: 'send', localId, text: value, at: Date.now() })
      await invoke('clone:chat', { contactId, threadId: id, text: value })
    } catch (e) {
      dispatch({ type: 'error', message: message(e), localId })
    }
  }

  /** Runs only from the DangerDialog's 清空 button — never straight from the menu. */
  const clear = async () => {
    if (!state.threadId) {
      setClearOpen(false)
      return
    }
    setClearing(true)
    try {
      await invoke('agent:submit', { type: 'thread.clear', threadId: state.threadId })
      dispatch({ type: 'clear' })
      toast.success(t('clone.chat.cleared'))
    } catch (e) {
      toast.error(t('clone.chat.clearFailed'), { detail: message(e) })
    } finally {
      setClearing(false)
      setClearOpen(false)
    }
  }

  const feedback = async (m: PersonaMessage, verdict: Verdict, correction?: string, saveAsSample?: boolean) => {
    try {
      await invoke('clone:feedback', { contactId, messageItemId: m.id, verdict, correction, saveAsSample })
      // A failed sample save reports itself; the verdict above was still recorded.
      if (saveAsSample && correction) await onSaveSample(correction)
      // 「不像 TA」 + a correction becomes a binding rule for the next turn: show it in 扮演纠正 right away
      if (verdict === 'not_like' && correction?.trim()) onNotesChanged?.()
    } catch (e) {
      toast.error(t('clone.chat.feedbackFailed'), { detail: message(e) })
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
          {loadingThread ? (
            <div className="flex items-center justify-center gap-2 py-6 text-caption text-fg-3">
              <Spinner size={13} /> {t('clone.chat.loading')}
            </div>
          ) : (
            <div className="flex justify-center">
              <span className="rounded-chip bg-line-6 px-3 py-1 text-micro text-fg-3">{t('clone.chat.ready')}</span>
            </div>
          )}
          {state.messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} m={m} selfName={selfName} />
            ) : (
              <AssistantBubble
                key={m.id}
                m={m}
                contactId={contactId}
                name={name}
                avatarPath={avatarPath}
                onFeedback={feedback}
                onSaveSample={onSaveSample}
                onRequestClear={() => setClearOpen(true)}
              />
            ),
          )}
          {state.generating && !state.messages.some((m) => m.streaming) ? (
            <div className="flex items-center gap-2 text-micro text-fg-3">
              <Avatar id={contactId} name={name} src={avatarPath} size={20} /> {t('clone.chat.typing', { name })}
            </div>
          ) : null}
          {state.error ? (
            <InlineHint kind="error">
              {state.error}
              {lastSent ? (
                <Button variant="link" size="sm" className="ml-2 h-5" onClick={() => void send(lastSent)}>
                  {t('common.retry')}
                </Button>
              ) : null}
            </InlineHint>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto flex w-full max-w-[720px] items-end gap-2 rounded-item border border-line-8 bg-content p-1.5 focus-within:border-accent/70">
          <Textarea
            autosize
            minRows={1}
            maxRows={6}
            aria-label={t('clone.actions.talk')}
            value={text}
            placeholder={t('clone.chat.inputPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            className="border-0 bg-transparent focus:border-0 hover:border-0"
            wrapperClassName="flex-1"
          />
          <IconButton
            icon={ArrowUp}
            label={t('common.send')}
            disabled={!text.trim() || state.generating}
            loading={state.generating}
            onClick={() => void send()}
            className="mb-0.5 rounded-chip bg-accent text-(--fg-on-accent) hover:bg-accent-hover hover:text-(--fg-on-accent) disabled:opacity-40"
          />
        </div>
      </div>
      <DangerDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('clone.chat.clearTitle')}
        description={t('clone.chat.clearDescription', { name })}
        confirmLabel={t('common.clear')}
        loading={clearing}
        onConfirm={clear}
      />
    </div>
  )
}

function UserBubble({ m, selfName }: { m: PersonaMessage; selfName?: string }) {
  const t = useT()
  return (
    <div className="flex items-end justify-end gap-2">
      <div className="flex max-w-[72%] flex-col items-end gap-0.5">
        <span className="font-latin text-micro text-fg-3">{formatClock(m.at)}</span>
        <div
          className={cn(
            'rounded-item rounded-br-sm bg-bubble-self px-3 py-1.5 text-bubble leading-[22px] text-white',
            m.pending && 'opacity-80',
          )}
        >
          {m.text}
        </div>
      </div>
      <Avatar id="me" name={selfName ?? t('common.me')} size={28} />
    </div>
  )
}

interface AssistantBubbleProps {
  m: PersonaMessage
  contactId: string
  name: string
  avatarPath?: string
  onFeedback: (m: PersonaMessage, verdict: Verdict, correction?: string, saveAsSample?: boolean) => Promise<void>
  onSaveSample: (reply: string) => Promise<boolean>
  /** Opens the 清空试聊记录 confirmation (the parent owns the dialog and the actual clear). */
  onRequestClear: () => void
}

function AssistantBubble({
  m,
  contactId,
  name,
  avatarPath,
  onFeedback,
  onSaveSample,
  onRequestClear,
}: AssistantBubbleProps) {
  const t = useT()
  const [voted, setVoted] = useState<Verdict | null>(null)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correction, setCorrection] = useState('')
  const [asSample, setAsSample] = useState(true)

  // one reply = several WeChat bubbles; feedback / copy / samples still act on the whole reply
  const bubbles = bubblesOf(m)
  const plain = bubbles.join('\n')

  const vote = async (v: Verdict) => {
    setVoted(v)
    await onFeedback(m, v)
  }
  const copy = () =>
    navigator.clipboard
      .writeText(plain)
      .then(() => toast.success(t('clone.chat.copied')))
      .catch(() => toast.error(t('common.copyFailed')))
  /** One toast either way: a failed save already reported its error. */
  const saveSample = async () => {
    if (await onSaveSample(plain)) toast.success(t('clone.chat.savedAsSample'))
  }

  const menu: MenuSpec = [
    { id: 'copy', label: t('common.copy'), icon: Copy, onSelect: () => void copy() },
    {
      id: 'sample',
      label: t('clone.chat.saveAsSample'),
      icon: Quote,
      onSelect: () => void saveSample(),
    },
    { type: 'separator' },
    { id: 'notlike', label: t('clone.chat.markNotLike'), icon: UserRoundX, onSelect: () => setCorrectionOpen(true) },
    { type: 'separator' },
    { id: 'clear', label: t('clone.chat.clear'), icon: Trash, danger: true, onSelect: onRequestClear },
  ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-start gap-2">
          <Avatar id={contactId} name={name} src={avatarPath} size={28} />
          <div className="flex min-w-0 max-w-[72%] flex-col items-start gap-1">
            <span className="flex min-w-0 max-w-full items-center gap-1.5 text-micro text-fg-3">
              <span className="min-w-0 truncate">{name}</span> <Badge tone="clone">{t('clone.chat.cloneBadge')}</Badge>{' '}
              <span className="shrink-0 font-latin">{formatClock(m.at)}</span>
            </span>
            {bubbles.map((bubble, i) => (
              <div
                key={i}
                className="whitespace-pre-wrap break-words rounded-item rounded-tl-sm border border-line-6 bg-panel px-3 py-1.5 text-bubble leading-[22px] text-fg"
              >
                {bubble || (m.streaming ? '…' : '')}
                {m.streaming && i === bubbles.length - 1 ? (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-accent align-middle" aria-hidden />
                ) : null}
              </div>
            ))}
            {!m.streaming && m.text ? (
              <div
                className={cn(
                  'flex items-center gap-1',
                  voted || correctionOpen ? 'flex' : 'invisible group-hover:visible',
                )}
              >
                <Button
                  variant={voted === 'up' ? 'link' : 'ghost'}
                  size="sm"
                  icon={ThumbsUp}
                  onClick={() => void vote('up')}
                  className={cn(voted === 'up' && 'text-ok')}
                >
                  {voted === 'up' ? t('clone.chat.votedUp') : t(VERDICT_LABEL.up)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ThumbsDown}
                  onClick={() => void vote('down')}
                  className={cn(voted === 'down' && 'text-warn')}
                >
                  {t(VERDICT_LABEL.down)}
                </Button>
                <Popover open={correctionOpen} onOpenChange={setCorrectionOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" icon={UserRoundX}>
                      {t(VERDICT_LABEL.not_like)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="flex w-[300px] flex-col gap-2.5">
                    <div className="text-body font-medium text-fg">{t('clone.chat.correctionTitle', { name })}</div>
                    <Textarea
                      autosize
                      minRows={2}
                      maxRows={5}
                      autoFocus
                      aria-label={t('clone.chat.correctionLabel')}
                      value={correction}
                      placeholder={t('clone.chat.correctionPlaceholder')}
                      onChange={(e) => setCorrection(e.target.value)}
                    />
                    <Checkbox
                      checked={asSample}
                      onCheckedChange={(c) => setAsSample(c === true)}
                      label={t('clone.chat.correctionAsSample')}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setCorrectionOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!correction.trim()}
                        onClick={async () => {
                          setCorrectionOpen(false)
                          setVoted('not_like')
                          await onFeedback(m, 'not_like', correction.trim(), asSample)
                          setCorrection('')
                        }}
                      >
                        {t('clone.chat.submitCorrection')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <IconButton size="xs" icon={Copy} label={t('common.copy')} onClick={() => void copy()} />
                <IconButton
                  size="xs"
                  icon={MessageSquareQuote}
                  label={t('clone.chat.saveAsSample')}
                  onClick={() => void saveSample()}
                />
              </div>
            ) : null}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
