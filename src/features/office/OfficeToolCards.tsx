/**
 * Cards under office tool-call rows in the agent panel:
 *   office_connect     — the live connect flow (steps, the opened link + QR, result), CLAUDE.md §4.5
 *   office_push_table  — the pushed table with 在飞书中打开, so the result is one click away
 */
import { Copy, ExternalLink, Table2 } from 'lucide-react'
import { isOfficeHostUrl, isOfficePlatform, type JsonValue, type OfficePlatform } from '@aiwc/protocol'
import type { ToolCardProps } from '@/features/agent/toolCards'
import { useT } from '@/i18n'
import { Button, IconButton, ICON_STROKE } from '@/kit'
import { openUrl } from '@/platform/openExternal'
import { copyToClipboard, OfficeConnectPanel, PLATFORM_KEY, TABLE_NOUN_KEY } from './OfficeConnectPanel'
import { useSessionForCall } from './officeStore'

type JsonRecord = { [key: string]: JsonValue }

const isRecord = (v: unknown): v is JsonRecord => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function platformOf(input: unknown): OfficePlatform | undefined {
  return isRecord(input) && isOfficePlatform(input.platform) ? input.platform : undefined
}

export function OfficeConnectCard({ call }: ToolCardProps) {
  const session = useSessionForCall(call.callId, platformOf(call.input), call.status === 'running')
  // Nothing before approval, and nothing once main has forgotten the session (the row still says how it went).
  if (!session) return null
  return <OfficeConnectPanel session={session} className="rounded-item border border-line-6 bg-panel px-2.5 py-2" />
}

export function OfficePushCard({ call }: ToolCardProps) {
  const t = useT()
  const out = call.output
  if (call.status !== 'done' || !isRecord(out) || out.ok !== true || !isOfficePlatform(out.platform)) return null
  const platform = out.platform
  const name = t(PLATFORM_KEY[platform])
  const url = typeof out.url === 'string' && isOfficeHostUrl(platform, out.url) ? out.url : undefined
  const rows = typeof out.rows === 'number' ? out.rows : 0
  const summary = t(out.mode === 'append' ? 'office.push.appended' : 'office.push.created', {
    rows,
    platform: name,
    noun: t(TABLE_NOUN_KEY[platform]),
  })
  // The agent panel is 360px wide: text first at full width, actions on their own line underneath.
  return (
    <div
      className="flex items-start gap-2.5 rounded-item border border-line-6 bg-panel px-2.5 py-2"
      data-testid="office-push-card"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-accent-15 text-accent">
        <Table2 size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-caption font-medium leading-[18px] text-fg">
          {typeof out.title === 'string' ? out.title : summary}
        </span>
        <span className="text-micro text-fg-3">{summary}</span>
        {url ? (
          <div className="mt-1 flex items-center gap-1">
            <Button size="sm" variant="outline" icon={ExternalLink} onClick={() => void openUrl(url)}>
              {t('office.push.open', { platform: name })}
            </Button>
            <IconButton
              size="sm"
              icon={Copy}
              label={t('office.push.copyLink')}
              onClick={() => void copyToClipboard(url, t('office.push.linkWhat'), t)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
