/**
 * 系统自动检查 in the transcript (CLAUDE.md §5): the host's checks of an answer (the citation audit) as one compact
 * row at the end of the turn — 「已核对 5 处引用 · 1 处不符，已重写」 — that opens for what did not match. A turn
 * whose answer was rewritten holds several checks of one kind; only the last of them draws the row, summarising
 * them all, so the folded work does not repeat it.
 */
import { ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useId, useState } from 'react'
import type { TurnCheck, TurnCheckIssue } from '@aiwc/protocol'
import { useT, type Translator } from '@/i18n'
import { cn, ICON_STROKE } from '@/kit'
import { Markdown } from '../MarkdownView'
import type { ThreadItem } from '../model'

export type CheckItem = Extract<ThreadItem, { kind: 'check' }>

type Tone = 'ok' | 'warn' | 'busy'

/** The row's sentence for a kind's checks in order (the first failing one is what was found). */
export function checkSummary(
  checks: readonly TurnCheck[],
  running: boolean,
  t: Translator,
): { text: string; tone: Tone } {
  const last = checks[checks.length - 1]
  const first = checks.find((c) => c.failed > 0)
  if (!last) return { text: '', tone: 'ok' }
  const n = (first ?? last).checked
  if (!first) return { text: t('agent.check.citations.passed', { n: last.checked }), tone: 'ok' }
  if (last.action === 'rewrite')
    return running
      ? { text: t('agent.check.citations.rewriting', { n, failed: first.failed }), tone: 'busy' }
      : { text: t('agent.check.citations.kept', { n, failed: first.failed }), tone: 'warn' }
  if (first !== last)
    return last.failed === 0
      ? { text: t('agent.check.citations.rewritten', { n, failed: first.failed }), tone: 'ok' }
      : {
          text: t('agent.check.citations.rewrittenStill', { n, failed: first.failed, left: last.failed }),
          tone: 'warn',
        }
  return { text: t('agent.check.citations.kept', { n, failed: first.failed }), tone: 'warn' }
}

const issueKey = (issue: TurnCheckIssue) =>
  `${issue.code}|${issue.link}|${issue.code === 'quote_mismatch' ? issue.quote : ''}`

export interface CheckRowProps {
  item: CheckItem
  /** Every check item of the turn, in order. */
  turnChecks: readonly CheckItem[]
  running: boolean
}

export function CheckRow({ item, turnChecks, running }: CheckRowProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const sameKind = turnChecks.filter((c) => c.check.kind === item.check.kind)
  if (sameKind[sameKind.length - 1]?.id !== item.id) return null
  const checks = sameKind.map((c) => c.check)
  const { text, tone } = checkSummary(checks, running, t)
  const issues: TurnCheckIssue[] = []
  const seen = new Set<string>()
  let unlisted = 0
  for (const check of checks) {
    unlisted += Math.max(0, check.failed - check.issues.length)
    for (const issue of check.issues) {
      if (seen.has(issueKey(issue))) continue
      seen.add(issueKey(issue))
      issues.push(issue)
    }
  }
  const expandable = issues.length > 0 || unlisted > 0
  const Icon = tone === 'warn' ? ShieldAlert : ShieldCheck
  const line = (
    <>
      <Icon
        size={14}
        strokeWidth={ICON_STROKE}
        aria-hidden
        className={cn('shrink-0', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-fg-3')}
      />
      <span className="sr-only">{t('agent.check.label')}</span>
      <span title={text} className={cn('min-w-0 truncate', tone === 'busy' && 'kit-shimmer')}>
        {text}
      </span>
    </>
  )
  return (
    <div className="flex min-w-0 flex-col" data-item="check" data-tone={tone}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen(!open)}
          className="group/check -mx-1 flex min-h-7 min-w-0 max-w-full items-center gap-2 self-start rounded-control px-1 text-left text-body text-fg-3 outline-none hover:text-fg-2"
        >
          {line}
          <ChevronRight
            size={14}
            strokeWidth={ICON_STROKE}
            aria-hidden
            className={cn(
              'shrink-0 opacity-0 transition-[opacity,transform] group-hover/check:opacity-100 group-focus-visible/check:opacity-100',
              open && 'rotate-90 opacity-100',
            )}
          />
        </button>
      ) : (
        <div className="flex min-h-7 min-w-0 items-center gap-2 text-body text-fg-3">{line}</div>
      )}
      {open && expandable ? (
        <ul
          id={detailId}
          className="m-0 ml-[7px] mt-1 mb-1 flex list-none flex-col gap-2 border-l border-line-8 p-0 pl-3.5"
        >
          {issues.map((issue) => (
            <li key={issueKey(issue)} className="flex min-w-0 flex-col gap-0.5 text-caption text-fg-2">
              {issue.code === 'missing_message' ? (
                <span>{t('agent.check.issue.missing')}</span>
              ) : (
                <>
                  <span className="break-words">{t('agent.check.issue.mismatch', { quote: issue.quote })}</span>
                  <span className="break-words text-fg-3">
                    {t('agent.check.issue.excerpt', { excerpt: issue.excerpt })}
                  </span>
                </>
              )}
              {/* the cited link itself: a chip that opens the message in its chat */}
              <Markdown text={issue.link} className="text-caption" />
            </li>
          ))}
          {unlisted > 0 ? (
            <li className="text-caption text-fg-3">{t('agent.check.issue.more', { n: unlisted })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
