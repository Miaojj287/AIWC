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
import { citationTime, verifyClaim, type CitationRef, type QuoteVerdict } from './citations'
import { resolveCitation } from './citationResolver'

export interface CitationChipProps extends CitationRef {
  /** Link text the model wrote; shown until the message resolves, and when it cannot. */
  label: string
  /** The quotes this citation vouches for (paired by @aiwc/protocol planCitations). */
  quotes: readonly string[]
  /** Citations written together with this one: a quote paired with the wrong one of them still counts as real. */
  run: readonly CitationRef[]
}

type State =
  | { status: 'loading' }
  | { status: 'missing'; title?: string }
  | { status: 'error' }
  | {
      status: 'found'
      verdict: QuoteVerdict
      /** First quote found neither in this message nor in the others of its run. */
      unmatched?: string
      sender: string
      time: string
      excerpt: string
      title?: string
    }

type Tone = 'loading' | 'ok' | 'warn' | 'danger'

/** Badge recipe (CLAUDE.md §2.2): colour at 14% ground + 30% border + the hue's ink for the 11px text. */
const TONE_CLASS: Record<Tone, string> = {
  loading: 'border-(--line-16) bg-transparent text-fg-3',
  ok: 'border-accent-30 bg-accent-12 text-accent-ink hover:bg-accent-15',
  warn: 'border-warn/30 bg-warn/14 text-warn-ink hover:bg-warn/20',
  danger: 'border-danger/30 bg-danger/14 text-danger-ink',
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
        ? {
            content: state.unmatched
              ? t('agent.citation.notInMessage', { quote: state.unmatched })
              : t('agent.citation.mismatch'),
            description: state.excerpt,
          }
        : { content: t('agent.citation.locate'), description: state.excerpt }
    case 'missing':
      return { content: t('agent.citation.missing'), description: t('agent.citation.missingDetail') }
    case 'error':
      return { content: t('agent.citation.unavailable'), description: t('agent.citation.unavailableDetail') }
    default:
      return { content: t('agent.citation.checking') }
  }
}

export function CitationChip({ sessionId, messageId, label, quotes, run }: CitationChipProps) {
  const t = useT()
  const [state, setState] = useState<State>({ status: 'loading' })
  // Arrays are rebuilt with every streamed delta; the check depends on their contents only.
  const quotesKey = quotes.join('\u0000')
  const runKey = run.map((r) => `${r.sessionId}/${r.messageId}`).join('|')

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    const quoteList = quotesKey ? quotesKey.split('\u0000') : []
    const siblings = runKey
      .split('|')
      .filter((key) => key && key !== `${sessionId}/${messageId}`)
      .map((key) => {
        const slash = key.indexOf('/')
        return { sessionId: key.slice(0, slash), messageId: key.slice(slash + 1) }
      })
    resolveCitation({ sessionId, messageId })
      .then(async ({ message, session }) => {
        if (!alive) return
        if (!message) {
          setState({ status: 'missing', title: session?.title })
          return
        }
        let check = verifyClaim(quoteList, message)
        if (check.verdict === 'mismatch' && siblings.length > 0) {
          const others = await Promise.all(siblings.map((ref) => resolveCitation(ref).catch(() => undefined)))
          if (!alive) return
          const found = others.flatMap((r) => (r?.message ? [r.message] : []))
          check = verifyClaim(quoteList, message, found)
        }
        const sender = message.isSelf
          ? t('common.me')
          : message.senderName?.trim() || message.senderId || t('agent.citation.otherParty')
        const excerpt = (message.media?.transcript || message.text || `[${message.kind}]`)
          .replace(/\s+/g, ' ')
          .slice(0, 80)
        setState({
          status: 'found',
          verdict: check.verdict,
          unmatched: check.unmatched[0],
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
  }, [sessionId, messageId, quotesKey, runKey, t])

  const tone = toneOf(state)
  const Icon = tone === 'warn' ? TriangleAlert : tone === 'danger' ? CircleAlert : MessageSquareQuote
  const text = state.status === 'found' ? `${state.sender} · ${state.time}` : label
  const tip = tipOf(state, t)
  const title = (state.status === 'found' || state.status === 'missing' ? state.title : undefined) ?? sessionId
  // Nothing to open when the message is gone or the lookup failed. aria-disabled (not `disabled`) keeps the chip
  // focusable and hoverable, so the tooltip can still say why.
  const unavailable = state.status === 'missing' || state.status === 'error'

  return (
    <Tooltip content={tip.content} description={tip.description}>
      <button
        type="button"
        data-citation={`${sessionId}/${messageId}`}
        data-verdict={state.status === 'found' ? state.verdict : state.status}
        className={cn(
          'mx-0.5 inline-flex h-[18px] max-w-full items-center gap-1 rounded-chip border px-1.5 align-[-3px] font-latin text-micro leading-none transition-colors',
          TONE_CLASS[tone],
          unavailable && 'cursor-not-allowed',
        )}
        aria-disabled={unavailable || undefined}
        onClick={() => {
          if (!unavailable) runCommand('tab.openChat', { sessionId, title, focusMessageId: messageId })
        }}
      >
        <Icon size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
        <span className="truncate">{text}</span>
      </button>
    </Tooltip>
  )
}
