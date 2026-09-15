/**
 * The chip a `wx://` citation renders as inside an Agent reply: sender · time, colour-coded by what
 * the check found (accent = the quote is verbatim / nothing to check, warn = the quoted text is not
 * in that message, danger = the message is not in the local index). Click → the chat tab opens (or
 * comes to front) and scrolls to the message (tab.openChat with focusMessageId).
 */
import { CircleAlert, MessageSquareQuote, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { runCommand } from '@/app/commands'
import { useT, type Translator } from '@/i18n'
import { cn, ICON_STROKE, Tooltip } from '@/kit'
import { citationTime, verifyQuotes, type CitationRef, type QuoteVerdict } from './citations'
import { resolveCitation } from './citationResolver'

export interface CitationChipProps extends CitationRef {
  /** Link text the model wrote; shown until the message resolves, and when it cannot. */
  label: string
  /** Reply text since the previous citation in the same block: the quotes in it are checked. */
  context: string
}

type State =
  | { status: 'loading' }
  | { status: 'missing'; title?: string }
  | { status: 'error' }
  | { status: 'found'; verdict: QuoteVerdict; sender: string; time: string; excerpt: string; title?: string }

type Tone = 'loading' | 'ok' | 'warn' | 'danger'

/** Badge recipe (CLAUDE.md §2.2): colour at 14% ground + 30% border + full-strength text. */
const TONE_CLASS: Record<Tone, string> = {
  loading: 'border-(--line-16) bg-transparent text-fg-3',
  ok: 'border-accent/30 bg-accent-12 text-accent hover:bg-accent-15',
  warn: 'border-warn/30 bg-warn/14 text-warn hover:bg-warn/20',
  danger: 'border-danger/30 bg-danger/14 text-danger hover:bg-danger/20',
}

function toneOf(state: State): Tone {
  if (state.status === 'found') return state.verdict === 'mismatch' ? 'warn' : 'ok'
  if (state.status === 'missing') return 'danger'
  if (state.status === 'error') return 'warn'
  return 'loading'
}

function tipOf(state: State, t: Translator): { content: string; description?: string } {
  switch (state.status) {
    case 'found':
      return state.verdict === 'mismatch'
        ? { content: t('agent.citation.mismatch'), description: state.excerpt }
        : { content: t('agent.citation.locate'), description: state.excerpt }
    case 'missing':
      return { content: t('agent.citation.missing'), description: t('agent.citation.missingDetail') }
    case 'error':
      return { content: t('agent.citation.unavailable'), description: t('agent.citation.unavailableDetail') }
    default:
      return { content: t('agent.citation.checking') }
  }
}

export function CitationChip({ sessionId, messageId, label, context }: CitationChipProps) {
  const t = useT()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    resolveCitation({ sessionId, messageId })
      .then(({ message, session }) => {
        if (!alive) return
        if (!message) {
          setState({ status: 'missing', title: session?.title })
          return
        }
        const sender = message.isSelf
          ? t('common.me')
          : message.senderName?.trim() || message.senderId || t('agent.citation.otherParty')
        const excerpt = (message.media?.transcript || message.text || `[${message.kind}]`)
          .replace(/\s+/g, ' ')
          .slice(0, 80)
        setState({
          status: 'found',
          verdict: verifyQuotes(context, message),
          sender,
          time: citationTime(message.createdAt),
          excerpt,
          title: session?.title,
        })
      })
      .catch(() => {
        if (alive) setState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [sessionId, messageId, context, t])

  const tone = toneOf(state)
  const Icon = tone === 'warn' ? TriangleAlert : tone === 'danger' ? CircleAlert : MessageSquareQuote
  const text = state.status === 'found' ? `${state.sender} · ${state.time}` : label
  const tip = tipOf(state, t)
  const title = (state.status === 'found' || state.status === 'missing' ? state.title : undefined) ?? sessionId

  return (
    <Tooltip content={tip.content} description={tip.description}>
      <button
        type="button"
        data-citation={`${sessionId}/${messageId}`}
        data-verdict={state.status === 'found' ? state.verdict : state.status}
        className={cn(
          'mx-0.5 inline-flex h-[18px] max-w-full items-center gap-1 rounded-chip border px-1.5 align-[-3px] font-latin text-micro leading-none transition-colors',
          TONE_CLASS[tone],
        )}
        onClick={() => runCommand('tab.openChat', { sessionId, title, focusMessageId: messageId })}
      >
        <Icon size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
        <span className="truncate">{text}</span>
      </button>
    </Tooltip>
  )
}
