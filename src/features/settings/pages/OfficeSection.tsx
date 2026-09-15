/**
 * 账号 › 办公平台 — 飞书 / 钉钉 / 企业微信 connection rows (status badge, account, 连接 / 重新授权 / 断开),
 * the connect flow in a long-task dialog (same steps + link + QR as the agent card), and the last few
 * pushed tables. The agent is the main way in; this is where the state is visible and reversible.
 */
import { ExternalLink, Link2, RefreshCw, RotateCw, Table2, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  OFFICE_PLATFORMS,
  isOfficeHostUrl,
  type OfficePlatform,
  type OfficePlatformStatus,
  type OfficePushRecord,
} from '@aiwc/protocol'
import {
  isActiveSession,
  OfficeConnectPanel,
  PLATFORM_KEY,
  TABLE_NOUN_KEY,
  upsertSession,
  useOfficeSession,
} from '@/features/office'
import { useT, type MessageKey } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  DangerDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
  Tooltip,
} from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import { errorMessage } from '../hooks'
import { SRow, Section } from '../pageKit'

const ROW_DESC: Record<OfficePlatform, MessageKey> = {
  feishu: 'office.settings.rowDesc.feishu',
  dingtalk: 'office.settings.rowDesc.dingtalk',
  wecom: 'office.settings.rowDesc.wecom',
}

export function OfficeSection() {
  const t = useT()
  const status = useInvoke('office:status', undefined, [])
  const pushes = useInvoke('office:pushes', { limit: 5 }, [])
  const [sessionId, setSessionId] = useState<string>()
  const session = useOfficeSession(sessionId)
  const [starting, setStarting] = useState<OfficePlatform | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [confirm, setConfirm] = useState<OfficePlatform | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const finishedState = session && !isActiveSession(session) ? session.state : undefined
  useEffect(() => {
    if (finishedState) status.reload()
    // reload is stable; only a flow finishing should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedState])

  const connect = async (platform: OfficePlatform, reauthorize = false) => {
    setStarting(platform)
    try {
      const started = await invoke('office:connect', { platform, reauthorize })
      upsertSession(started)
      setSessionId(started.id)
    } catch (e) {
      toast.error(t('office.settings.actionFailed'), { detail: errorMessage(e) })
    } finally {
      setStarting(null)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await invoke('office:status', { refresh: true })
      status.reload()
      pushes.reload()
    } catch (e) {
      toast.error(t('office.settings.loadFailed'), { detail: errorMessage(e) })
    } finally {
      setRefreshing(false)
    }
  }

  const disconnect = async (platform: OfficePlatform) => {
    setDisconnecting(true)
    try {
      await invoke('office:disconnect', { platform })
      toast.success(t('office.settings.disconnected', { platform: t(PLATFORM_KEY[platform]) }))
      status.reload()
    } catch (e) {
      toast.error(t('office.settings.actionFailed'), { detail: errorMessage(e) })
    } finally {
      setDisconnecting(false)
      setConfirm(null)
    }
  }

  const byPlatform = new Map((status.data ?? []).map((s) => [s.platform, s]))
  const dialogPlatform = session ? t(PLATFORM_KEY[session.platform]) : ''

  return (
    <Section
      title={t('office.settings.title')}
      help={t('office.settings.help')}
      aside={
        <IconButton
          size="xs"
          icon={RefreshCw}
          label={t('office.settings.refresh')}
          loading={refreshing}
          onClick={() => void refresh()}
          className="text-fg-3"
        />
      }
    >
      {status.error && !status.data ? (
        <Card>
          <EmptyState
            compact
            variant="error"
            title={t('office.settings.loadFailed')}
            description={errorMessage(status.error)}
            action={{
              label: t('office.settings.refresh'),
              onClick: () => void refresh(),
              icon: RefreshCw,
              variant: 'ghost',
            }}
          />
        </Card>
      ) : (
        <Card variant="rows">
          {OFFICE_PLATFORMS.map((platform) => (
            <PlatformRow
              key={platform}
              platform={platform}
              status={byPlatform.get(platform)}
              loading={status.loading && !status.data}
              starting={starting === platform}
              busy={Boolean(session && isActiveSession(session))}
              onConnect={(reauthorize) => void connect(platform, reauthorize)}
              onDisconnect={() => setConfirm(platform)}
            />
          ))}
        </Card>
      )}
      <p className="m-0 px-1 text-micro leading-4 text-fg-3">{t('office.settings.dataNote')}</p>

      <RecentPushes records={pushes.data} />

      <Dialog
        open={Boolean(session)}
        onOpenChange={(open) => (!open && session && !isActiveSession(session) ? setSessionId(undefined) : undefined)}
      >
        {session ? (
          <DialogContent
            size="lg"
            lockOutside
            lockEscape={isActiveSession(session)}
            hideClose={isActiveSession(session)}
          >
            <DialogHeader
              icon={Link2}
              title={t('office.settings.dialogTitle', { platform: dialogPlatform })}
              description={t(ROW_DESC[session.platform])}
            />
            <DialogBody>
              <OfficeConnectPanel session={session} showPrivacy onRetry={() => void connect(session.platform, true)} />
            </DialogBody>
          </DialogContent>
        ) : null}
      </Dialog>

      <DangerDialog
        open={confirm !== null}
        onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}
        title={confirm ? t('office.settings.disconnectTitle', { platform: t(PLATFORM_KEY[confirm]) }) : ''}
        description={confirm ? t('office.settings.disconnectBody', { platform: t(PLATFORM_KEY[confirm]) }) : ''}
        confirmLabel={t('office.settings.disconnect')}
        loading={disconnecting}
        onConfirm={() => (confirm ? disconnect(confirm) : undefined)}
      />
    </Section>
  )
}

interface PlatformRowProps {
  platform: OfficePlatform
  status: OfficePlatformStatus | undefined
  loading: boolean
  starting: boolean
  /** Another connect flow is open in the dialog. */
  busy: boolean
  onConnect(reauthorize: boolean): void
  onDisconnect(): void
}

function PlatformRow({ platform, status, loading, starting, busy, onConnect, onDisconnect }: PlatformRowProps) {
  const t = useT()
  const connected = status?.auth === 'authorized'
  const account = status?.account
    ? [status.account.name, status.account.tenant].filter(Boolean).join(' · ') || status.account.id
    : undefined
  const description = [account, t(ROW_DESC[platform])].filter(Boolean).join(' · ')
  return (
    <SRow
      id={`account.office.${platform}`}
      title={t(PLATFORM_KEY[platform])}
      description={loading ? <Skeleton className="h-2.5 w-44" /> : description}
      badge={loading ? null : <StatusBadge status={status} />}
      help={status?.detail}
    >
      <div className="flex items-center gap-1.5">
        {status?.cli.version ? (
          <span className="hidden font-mono text-micro text-fg-3 @min-[640px]/settings:inline">
            {t('office.settings.cliVersion', { version: status.cli.version })}
          </span>
        ) : null}
        {connected ? (
          <>
            <Button variant="ghost" icon={RotateCw} disabled={busy} loading={starting} onClick={() => onConnect(true)}>
              {t('office.settings.reconnect')}
            </Button>
            {status?.canDisconnect ? (
              <Button variant="ghost" icon={Unlink} disabled={busy} onClick={onDisconnect}>
                {t('office.settings.disconnect')}
              </Button>
            ) : (
              <Tooltip content={t('office.settings.noLogout')} multiline>
                <span>
                  <Button variant="ghost" icon={Unlink} disabled>
                    {t('office.settings.disconnect')}
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        ) : (
          <Button
            variant="outline"
            icon={Link2}
            disabled={busy || loading}
            loading={starting}
            onClick={() => onConnect(status?.auth === 'expired')}
          >
            {status?.auth === 'expired' ? t('office.settings.reconnect') : t('office.settings.connect')}
          </Button>
        )}
      </div>
    </SRow>
  )
}

function StatusBadge({ status }: { status: OfficePlatformStatus | undefined }) {
  const t = useT()
  if (!status) return null
  if (status.auth === 'authorized') return <Badge tone="ok">{t('office.settings.status.connected')}</Badge>
  if (status.auth === 'expired') return <Badge tone="warn">{t('office.settings.status.expired')}</Badge>
  if (!status.installed) return <Badge tone="neutral">{t('office.settings.status.notInstalled')}</Badge>
  if (status.auth === 'unknown') return <Badge tone="warn">{t('office.settings.status.unknown')}</Badge>
  return <Badge tone="neutral">{t('office.settings.status.notConnected')}</Badge>
}

function RecentPushes({ records }: { records: OfficePushRecord[] | undefined }) {
  const t = useT()
  if (!records) return null
  return (
    <Card variant="rows" title={t('office.settings.recent')} className="mt-1">
      {records.length === 0 ? (
        <div className="px-4 py-3 text-note text-fg-3">{t('office.settings.recentEmpty')}</div>
      ) : (
        records.map((r) => {
          const url = r.url && isOfficeHostUrl(r.platform, r.url) ? r.url : undefined
          return (
            <div key={r.id} className="flex items-center gap-2.5 border-b border-line-6 px-4 py-2 last:border-b-0">
              <Table2 size={14} aria-hidden className="shrink-0 text-fg-3" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body text-fg">{r.title}</span>
                <span className="truncate text-micro text-fg-3">
                  {t(PLATFORM_KEY[r.platform])} {t(TABLE_NOUN_KEY[r.platform])} ·{' '}
                  {t('office.settings.rows', { rows: r.rows })} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {url ? (
                <IconButton
                  size="sm"
                  icon={ExternalLink}
                  label={t('office.push.open', { platform: t(PLATFORM_KEY[r.platform]) })}
                  onClick={() => void openUrl(url)}
                />
              ) : null}
            </div>
          )
        })
      )}
    </Card>
  )
}
