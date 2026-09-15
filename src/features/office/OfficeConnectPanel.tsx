/**
 * The body of a connect flow, shared by the agent tool card and the settings dialog: the step list
 * (✓ / ⟳ / ○ / !, CLAUDE.md §4.5), and while the flow waits on the browser, the link it already opened
 * with its QR code, code and expiry — so the user can always finish even if the browser did not open.
 */
import { Check, Circle, CircleAlert, Copy, ExternalLink, Minus, RotateCw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type {
  OfficeAuthLink,
  OfficeConnectSession,
  OfficeConnectStep,
  OfficeConnectStepId,
  OfficePlatform,
} from '@aiwc/protocol'
import { useT, type MessageKey, type Translator } from '@/i18n'
import { Button, cn, IconButton, ICON_STROKE, InlineHint, Spinner, toast } from '@/kit'
import { invoke } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import { isActiveSession } from './officeStore'

export const PLATFORM_KEY: Record<OfficePlatform, MessageKey> = {
  feishu: 'office.platform.feishu',
  dingtalk: 'office.platform.dingtalk',
  wecom: 'office.platform.wecom',
}

export const TABLE_NOUN_KEY: Record<OfficePlatform, MessageKey> = {
  feishu: 'office.tableNoun.feishu',
  dingtalk: 'office.tableNoun.dingtalk',
  wecom: 'office.tableNoun.wecom',
}

const STEP_KEY: Record<OfficeConnectStepId, MessageKey> = {
  install: 'office.step.install',
  app: 'office.step.app',
  authorize: 'office.step.authorize',
  verify: 'office.step.verify',
}

function stepLabel(t: Translator, platform: OfficePlatform, id: OfficeConnectStepId): string {
  return id === 'authorize' && platform === 'wecom' ? t('office.step.authorizeWecom') : t(STEP_KEY[id])
}

export async function copyToClipboard(text: string, what: string, t: Translator): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('common.copied', { what }))
  } catch (e) {
    toast.error(t('common.copyFailed'), { detail: e instanceof Error ? e.message : String(e) })
  }
}

export interface OfficeConnectPanelProps {
  session: OfficeConnectSession
  /** Offered once the flow failed or was cancelled. */
  onRetry?: () => void
  /** Settings dialog: add the one-line note on where credentials live. */
  showPrivacy?: boolean
  className?: string
}

export function OfficeConnectPanel({ session, onRetry, showPrivacy, className }: OfficeConnectPanelProps) {
  const t = useT()
  const platform = t(PLATFORM_KEY[session.platform])
  const active = isActiveSession(session)
  const visibleSteps = session.steps.filter((s) => s.state !== 'skipped')
  const cancel = () => void invoke('office:cancel', { sessionId: session.id }).catch(() => {})

  return (
    <div className={cn('flex flex-col gap-2', className)} data-office-session={session.state}>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {visibleSteps.map((step) => (
          <StepRow key={step.id} step={step} label={stepLabel(t, session.platform, step.id)} />
        ))}
      </ol>

      {session.link ? <LinkBox session={session} link={session.link} platform={platform} /> : null}

      {session.state === 'done' ? (
        <InlineHint kind="success">
          {session.status?.account?.name || session.status?.account?.tenant
            ? t('office.connect.doneAs', {
                platform,
                account: [session.status.account.name, session.status.account.tenant].filter(Boolean).join(' · '),
              })
            : t('office.connect.done', { platform })}
        </InlineHint>
      ) : null}
      {session.state === 'cancelled' ? (
        <InlineHint kind="info">{t('office.connect.cancelled', { platform })}</InlineHint>
      ) : null}
      {session.state === 'failed' ? <FailureBox session={session} platform={platform} /> : null}

      {active || ((session.state === 'failed' || session.state === 'cancelled') && onRetry) ? (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-micro text-fg-3">
            {showPrivacy ? t('office.connect.privacy') : null}
          </span>
          {active ? (
            <Button size="sm" variant="ghost" icon={X} onClick={cancel}>
              {t('office.connect.cancel')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" icon={RotateCw} onClick={onRetry}>
              {t('office.connect.retry')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

const STEP_ICON: Record<OfficeConnectStep['state'], ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  running: <Spinner size={13} />,
  pending: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
  skipped: <Minus size={12} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
}

function StepRow({ step, label }: { step: OfficeConnectStep; label: string }) {
  return (
    <li data-status={step.state} className="flex h-[22px] items-center gap-2">
      <span className="flex size-[13px] shrink-0 items-center justify-center">{STEP_ICON[step.state]}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-caption',
          step.state === 'pending'
            ? 'text-fg-3'
            : step.state === 'failed'
              ? 'text-danger'
              : step.state === 'running'
                ? 'text-fg'
                : 'text-fg-2',
        )}
      >
        {label}
      </span>
      {step.detail ? (
        <span className="max-w-[45%] shrink-0 truncate font-mono text-micro text-fg-3" title={step.detail}>
          {step.detail}
        </span>
      ) : null}
    </li>
  )
}

function useMinutesLeft(expiresAt: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [expiresAt])
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 60_000)) : undefined
}

function LinkBox({
  session,
  link,
  platform,
}: {
  session: OfficeConnectSession
  link: OfficeAuthLink
  platform: string
}) {
  const t = useT()
  const minutes = useMinutesLeft(link.expiresAt)
  const hint =
    link.purpose === 'app'
      ? t('office.connect.waitingApp')
      : session.platform === 'wecom'
        ? t('office.connect.waitingWecom')
        : t('office.connect.waitingAuthorize')
  const open = () => {
    invoke('office:openLink', { sessionId: session.id }).catch(() => void openUrl(link.url))
  }
  return (
    <div className="flex gap-3 rounded-item border border-accent/30 bg-accent/[0.06] p-2.5" data-testid="office-link">
      {link.qrDataUrl ? (
        <div className="flex shrink-0 flex-col items-center gap-1">
          {/* QR codes need dark-on-light to scan, whatever the theme. */}
          <img
            src={link.qrDataUrl}
            alt={t('office.connect.scanHint', { platform })}
            className="size-[96px] rounded-control bg-white p-1"
            draggable={false}
          />
          <span className="max-w-[104px] text-center text-micro leading-3 text-fg-3">
            {t('office.connect.scanHint', { platform })}
          </span>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-caption leading-[18px] text-fg">{hint}</span>
        {!link.opened ? <span className="text-micro text-warn">{t('office.connect.notOpened')}</span> : null}
        <button
          type="button"
          onClick={open}
          title={link.url}
          className="min-w-0 truncate rounded-control text-left font-mono text-micro text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {link.url}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" icon={ExternalLink} onClick={open}>
            {t('office.connect.openLink')}
          </Button>
          <IconButton
            size="sm"
            icon={Copy}
            label={t('office.connect.copyLink')}
            onClick={() => void copyToClipboard(link.url, t('office.connect.linkWhat'), t)}
          />
          {link.userCode ? (
            <span className="font-mono text-micro text-fg-2">
              {t('office.connect.userCode', { code: link.userCode })}
            </span>
          ) : null}
          {minutes !== undefined ? (
            <span className={cn('text-micro', minutes === 0 ? 'text-warn' : 'text-fg-3')}>
              {minutes === 0 ? t('office.connect.expired') : t('office.connect.expiresIn', { minutes })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FailureBox({ session, platform }: { session: OfficeConnectSession; platform: string }) {
  const t = useT()
  const error = session.error
  return (
    <div className="flex flex-col gap-1.5">
      <InlineHint kind="error">{t('office.connect.failed', { platform })}</InlineHint>
      {error?.message ? (
        <span className="select-text break-words pl-[18px] text-caption leading-[18px] text-fg-2">{error.message}</span>
      ) : null}
      {error?.command ? (
        <div className="flex flex-col gap-1">
          <span className="text-micro text-fg-3">{t('office.connect.manual')}</span>
          <div className="flex items-center gap-1 rounded-control border border-line-6 bg-content py-1 pl-2 pr-1">
            <code className="min-w-0 flex-1 truncate font-mono text-micro text-fg-2" title={error.command}>
              {error.command}
            </code>
            <IconButton
              size="xs"
              icon={Copy}
              label={t('office.connect.copyCommand')}
              onClick={() => void copyToClipboard(error.command as string, t('office.connect.commandWhat'), t)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
