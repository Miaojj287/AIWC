/**
 * The running turn's 「重新连接中 n/m」 / 继续生成 line, just above the composer at the end of the conversation (panel
 * and Agent window alike). It is the honest version of "still working": the model stopped sending output (or the
 * provider refused for a moment) and the kernel is asking again; or the answer hit the output limit and is being
 * continued. It disappears as soon as output flows again; when the retries run out the turn ends with an error card.
 */
import type { StreamRetryReason } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Spinner } from '@/kit'
import type { TurnSignal } from './turnSignals'

const REASON: Record<StreamRetryReason, MessageKey> = {
  stalled: 'agent.turnSignal.reason.stalled',
  rate_limit: 'agent.turnSignal.reason.rateLimit',
  network: 'agent.turnSignal.reason.network',
  server: 'agent.turnSignal.reason.server',
}

export function TurnSignalNotice({ signal }: { signal: TurnSignal | undefined }) {
  const t = useT()
  if (!signal) return null
  const text =
    signal.kind === 'reconnecting'
      ? t('agent.turnSignal.reconnecting', { n: signal.attempt, m: signal.max, reason: t(REASON[signal.reason]) })
      : t('agent.turnSignal.continuing', { n: signal.attempt, m: signal.max })
  return (
    <div role="status" data-testid="turn-signal" className="mb-2 flex min-w-0 items-center gap-2 px-1">
      <Spinner size={12} />
      <span className="kit-shimmer min-w-0 truncate text-caption text-fg-3" title={text}>
        {text}
      </span>
    </div>
  )
}
