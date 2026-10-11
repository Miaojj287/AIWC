/**
 * One model call from the log: metadata always; the recorded request / reply (API keys already removed by the main
 * process) when 记录内容 was on for it.
 */
import { Copy, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ModelCallDetail } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Dialog, DialogBody, DialogContent, DialogHeader, EmptyState, IconButton, Tooltip } from '@/kit'
import { formatDateTime, formatNumber } from '@/platform/format'
import { invoke } from '@/platform/hooks'
import { copyText, errorMessage } from '../../hooks'
import { formatSeconds } from '../../usageModel'

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; call: ModelCallDetail | null }

export function CallDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!id) return
    let live = true
    setState({ kind: 'loading' })
    invoke('models:getCall', { id }).then(
      (call) => live && setState({ kind: 'ready', call }),
      (e: unknown) => live && setState({ kind: 'error', message: errorMessage(e) }),
    )
    return () => {
      live = false
    }
  }, [id])

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader icon={ScrollText} title={t('settings.usage.calls.detail.title')} />
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {state.kind === 'loading' ? (
            <EmptyState compact variant="loading" title={t('common.loading')} />
          ) : state.kind === 'error' || !state.call ? (
            <EmptyState
              compact
              variant="error"
              title={t('settings.usage.calls.detail.loadFailed')}
              description={state.kind === 'error' ? state.message : undefined}
            />
          ) : (
            <CallDetail call={state.call} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function CallDetail({ call }: { call: ModelCallDetail }) {
  const t = useT()
  const tokens = [
    `${formatNumber(call.inputTokens)} → ${formatNumber(call.outputTokens)}`,
    call.cachedInputTokens ? t('settings.usage.calls.detail.cached', { n: formatNumber(call.cachedInputTokens) }) : '',
    call.reasoningTokens ? t('settings.usage.calls.detail.reasoning', { n: formatNumber(call.reasoningTokens) }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('settings.usage.calls.detail.time'), value: formatDateTime(call.at) },
    { label: t('settings.usage.calls.detail.feature'), value: t(`settings.usage.features.${call.feature}`) },
    { label: t('settings.usage.calls.detail.model'), value: `${call.providerId} / ${call.modelId}`, mono: true },
    { label: t('settings.usage.calls.detail.status'), value: t(`settings.usage.calls.status.${call.status}`) },
    { label: t('settings.usage.calls.detail.tokens'), value: tokens },
    {
      label: t('settings.usage.calls.detail.latency'),
      value: t('settings.usage.calls.seconds', { s: formatSeconds(call.latencyMs) }),
    },
    ...(call.firstTokenMs !== undefined
      ? [
          {
            label: t('settings.usage.calls.detail.firstToken'),
            value: t('settings.usage.calls.seconds', { s: formatSeconds(call.firstTokenMs) }),
          },
        ]
      : []),
    ...(call.status === 'error'
      ? [
          {
            label: t('settings.usage.calls.detail.error'),
            value: [call.httpStatus ? `HTTP ${call.httpStatus}` : '', call.errorCode ?? '', call.errorMessage ?? '']
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : []),
  ]
  return (
    <>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-caption">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-fg-3">{r.label}</dt>
            <dd className={r.mono ? 'm-0 break-all font-mono text-fg' : 'm-0 break-words text-fg'}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {call.hasContent ? (
        <>
          <ContentBlock label={t('settings.usage.calls.detail.request')} text={call.request ?? ''} />
          <ContentBlock label={t('settings.usage.calls.detail.response')} text={call.response ?? ''} />
        </>
      ) : (
        <p className="m-0 text-caption text-fg-3">{t('settings.usage.calls.detail.noContent')}</p>
      )}
    </>
  )
}

function ContentBlock({ label, text }: { label: string; text: string }) {
  const t = useT()
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-caption font-medium text-fg-2">{label}</h3>
        <Tooltip content={t('settings.usage.calls.detail.copy')}>
          <IconButton
            size="sm"
            icon={Copy}
            label={`${t('settings.usage.calls.detail.copy')} ${label}`}
            onClick={() => void copyText(text, label)}
          />
        </Tooltip>
      </div>
      <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-item border border-line-6 bg-panel p-3 font-mono text-caption text-fg-2">
        {text}
      </pre>
    </section>
  )
}
