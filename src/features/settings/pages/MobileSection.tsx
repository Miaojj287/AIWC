/**
 * 账号 › 我的微信 — connect the owner's own WeChat (QR login through the iLink bot), test / disconnect it, and the
 * 手机遥控 switch with the phone thread's permission mode (Ask / Bypass; Autopilot is not offered). Status is
 * live from 'mobile:changed'; disconnecting asks first (it forgets the bound account).
 */
import { MessageSquareShare, QrCode, RefreshCw, Send, Smartphone, Unlink } from 'lucide-react'
import { useState } from 'react'
import type { MobileRemoteMode, MobileRemoteSettings, MobileStatus } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  DangerDialog,
  EmptyState,
  ICON_STROKE,
  SegmentedControl,
  Skeleton,
  Spinner,
  Toggle,
  Tooltip,
  permissionModeName,
  toast,
} from '@/kit'
import { formatTime } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'
import { connectionView, SEND_KIND_KEY } from '../mobileModel'
import { SRow, Section } from '../pageKit'

const MODES: readonly MobileRemoteMode[] = ['ask', 'bypass']

export function MobileSection() {
  const t = useT()
  const initial = useInvoke('mobile:status', undefined, [])
  const [live, setLive] = useState<MobileStatus>()
  const [busy, setBusy] = useState<'connect' | 'cancel' | 'disconnect' | 'test' | 'remote' | null>(null)
  const [confirm, setConfirm] = useState(false)
  useBridgeEvent('mobile:changed', setLive)
  const status = live ?? initial.data

  const act = async <T,>(kind: NonNullable<typeof busy>, run: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind)
    try {
      return await run()
    } catch (e) {
      toast.error(t('mobile.settings.actionFailed'), { detail: errorMessage(e) })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const setRemote = async (next: MobileRemoteSettings) => {
    const result = await act('remote', () => invoke('mobile:setRemote', next))
    if (!result) return
    setLive(result)
    if (next.enabled !== status?.remote.enabled)
      toast.success(next.enabled ? t('mobile.settings.toast.remoteOn') : t('mobile.settings.toast.remoteOff'))
  }

  const sendTest = async () => {
    const record = await act('test', () => invoke('mobile:test', undefined))
    if (!record) return
    if (record.ok) toast.success(t('mobile.settings.testSent'))
    else toast.error(t('mobile.settings.testFailed'), { detail: record.error })
  }

  const disconnect = async () => {
    const result = await act('disconnect', () => invoke('mobile:disconnect', undefined))
    setConfirm(false)
    if (!result) return
    setLive(result)
    toast.success(t('mobile.settings.toast.disconnected'))
  }

  if (!status) {
    return (
      <Section title={t('mobile.settings.title')} help={t('mobile.settings.help')}>
        <Card>
          {initial.error ? (
            <EmptyState
              compact
              variant="error"
              title={t('mobile.settings.loadFailed')}
              description={errorMessage(initial.error)}
              action={{ label: t('mobile.settings.retry'), onClick: initial.reload, icon: RefreshCw, variant: 'ghost' }}
            />
          ) : (
            <div role="status" className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-64" />
            </div>
          )}
        </Card>
      </Section>
    )
  }

  const view = connectionView(status)
  const description = status.ownerUnknown
    ? t('mobile.settings.ownerUnknown')
    : [status.owner ? t('mobile.settings.ownerLine', { owner: status.owner }) : undefined, status.detail]
        .filter(Boolean)
        .join(' · ') || undefined
  const last = status.lastSend
  const lastLine = last
    ? last.ok
      ? t('mobile.settings.lastSend', { time: formatTime(last.at), kind: t(SEND_KIND_KEY[last.kind]) })
      : t('mobile.settings.lastSendFailed', {
          time: formatTime(last.at),
          kind: t(SEND_KIND_KEY[last.kind]),
          error: last.error ?? '',
        })
    : t('mobile.settings.noSends')
  const remoteReason = view.ready ? undefined : t('mobile.settings.remoteNeedsConnect')
  const threadId = status.remote.threadId

  return (
    <>
      <Section title={t('mobile.settings.title')} help={t('mobile.settings.help')}>
        <Card variant="rows">
          <SRow
            id="account.mobile"
            title={t('mobile.settings.connection')}
            description={description}
            badge={<Badge tone={view.badge.tone}>{t(view.badge.label)}</Badge>}
            footer={
              <div className="flex flex-col gap-2">
                {view.showQr ? <QrBlock dataUrl={status.qrDataUrl} /> : null}
                {status.persisted ? null : (
                  <span className="text-micro text-warn-ink">{t('mobile.settings.notPersisted')}</span>
                )}
                {status.owner ? (
                  <span className={last && !last.ok ? 'text-micro text-danger-ink' : 'text-micro text-fg-3'}>
                    {lastLine}
                  </span>
                ) : null}
              </div>
            }
          >
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {view.action === 'manage' ? (
                <>
                  <Button
                    variant="ghost"
                    icon={Send}
                    loading={busy === 'test'}
                    disabled={!view.ready}
                    disabledReason={remoteReason}
                    onClick={() => void sendTest()}
                  >
                    {t('mobile.settings.test')}
                  </Button>
                  <Button variant="ghost" icon={Unlink} onClick={() => setConfirm(true)}>
                    {t('mobile.settings.disconnect')}
                  </Button>
                </>
              ) : view.action === 'cancel' ? (
                <Button
                  variant="ghost"
                  loading={busy === 'cancel'}
                  onClick={() =>
                    void act('cancel', () => invoke('mobile:cancelLogin', undefined)).then((s) => s && setLive(s))
                  }
                >
                  {t('mobile.settings.cancel')}
                </Button>
              ) : (
                <>
                  {status.owner ? (
                    <Button variant="ghost" icon={Unlink} onClick={() => setConfirm(true)}>
                      {t('mobile.settings.disconnect')}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    icon={QrCode}
                    loading={busy === 'connect'}
                    onClick={() =>
                      void act('connect', () => invoke('mobile:connect', undefined)).then((s) => s && setLive(s))
                    }
                  >
                    {view.action === 'reconnect' ? t('mobile.settings.reconnect') : t('mobile.settings.connect')}
                  </Button>
                </>
              )}
            </div>
          </SRow>
        </Card>
      </Section>

      <Section title={t('mobile.settings.remoteTitle')} help={t('mobile.settings.remoteHelp')}>
        <Card variant="rows">
          <SRow id="account.mobileRemote" title={t('mobile.settings.remoteToggle')}>
            <Tooltip content={remoteReason} disabled={!remoteReason || status.remote.enabled}>
              <span className="inline-flex">
                <Toggle
                  label={t('mobile.settings.remoteToggle')}
                  checked={status.remote.enabled}
                  // Turning it off always works; turning it on needs a connected owner.
                  disabled={busy === 'remote' || (!view.ready && !status.remote.enabled)}
                  onCheckedChange={(enabled) => void setRemote({ ...status.remote, enabled })}
                />
              </span>
            </Tooltip>
          </SRow>
          <SRow
            id="account.mobileMode"
            title={t('mobile.settings.remoteMode')}
            help={t('mobile.settings.remoteModeDescription')}
          >
            <SegmentedControl
              aria-label={t('mobile.settings.remoteMode')}
              options={MODES.map((mode) => ({ value: mode, label: permissionModeName(mode) }))}
              value={status.remote.permissionMode}
              disabled={busy === 'remote'}
              onValueChange={(permissionMode) => void setRemote({ ...status.remote, permissionMode })}
            />
          </SRow>
          <SRow
            id="account.mobileThread"
            title={t('mobile.settings.openThread')}
            badge={
              status.remote.pendingApprovals ? (
                <Badge tone="warn">{t('mobile.settings.pending', { n: status.remote.pendingApprovals })}</Badge>
              ) : status.remote.running ? (
                <Badge tone="accent">{t('mobile.settings.running')}</Badge>
              ) : null
            }
          >
            <Button
              variant="ghost"
              icon={MessageSquareShare}
              disabled={!threadId}
              disabledReason={threadId ? undefined : t('mobile.settings.noThread')}
              onClick={() => (threadId ? runCommand('agent.openThread', { threadId }) : undefined)}
            >
              {t('mobile.settings.openThread')}
            </Button>
          </SRow>
        </Card>
      </Section>

      <DangerDialog
        open={confirm}
        onOpenChange={(open) => (!open ? setConfirm(false) : undefined)}
        icon={Unlink}
        title={t('mobile.settings.disconnectTitle')}
        description={t('mobile.settings.disconnectBody')}
        confirmLabel={t('mobile.settings.disconnect')}
        loading={busy === 'disconnect'}
        onConfirm={() => disconnect()}
      />
    </>
  )
}

function QrBlock({ dataUrl }: { dataUrl?: string }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 rounded-item border border-line-8 p-2.5" data-testid="mobile-qr">
      {dataUrl ? (
        // QR codes need dark-on-light to scan, whatever the theme.
        <img
          src={dataUrl}
          alt={t('mobile.settings.qrAlt')}
          className="size-[120px] shrink-0 rounded-control bg-white p-1"
          draggable={false}
        />
      ) : (
        <div className="flex size-[120px] shrink-0 items-center justify-center rounded-control bg-line-8">
          <Spinner />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-body font-medium text-fg">
          <Smartphone size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{t('mobile.settings.qrTitle')}</span>
        </span>
        <span className="text-caption text-fg-3">
          {dataUrl ? t('mobile.settings.qrHint') : t('mobile.settings.qrWaiting')}
        </span>
      </div>
    </div>
  )
}
