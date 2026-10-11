/**
 * 版本与支持 — version block, 检查更新 state machine (app:checkUpdate + 'app:update'), 协议 / 隐私 dialogs
 * and 导出日志 with a 定位文件 toast action. Figma 128:1854, board 151:415 ⑥.
 */
import { Download, FileText, RefreshCw, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { UpdateStatus, UpdateUnavailableReason } from '@aiwc/protocol'
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineHint,
  ProgressBar,
  Spinner,
  toast,
} from '@/kit'
import { useT } from '@/i18n'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'
import { PRIVACY, TERMS, type LegalDoc } from '../legalText'
import { SRow } from '../pageKit'

/** Why 检查更新 is disabled, per UpdateUnavailableReason. */
const UNAVAILABLE_REASON = {
  dev_build: 'settings.about.update.unavailable.dev_build',
  no_feed: 'settings.about.update.unavailable.no_feed',
  unsupported_platform: 'settings.about.update.unavailable.unsupported_platform',
} as const satisfies Record<UpdateUnavailableReason, string>

export function AboutPage() {
  const t = useT()
  const info = useInvoke('app:getInfo', undefined, [])
  // Main's updater state (it may already have found an update in the background); local state takes over
  // once this page checks or an 'app:update' event arrives.
  const updateState = useInvoke('update:getState', undefined, [])
  const [localUpdate, setUpdate] = useState<UpdateStatus | undefined>()
  const update: UpdateStatus = localUpdate ?? updateState.data?.status ?? { state: 'idle' }
  const unavailable = updateState.data?.unavailable ?? null
  const [legal, setLegal] = useState<LegalDoc | null>(null)
  const [exporting, setExporting] = useState(false)
  const [updateDialog, setUpdateDialog] = useState(false)

  useBridgeEvent('app:update', setUpdate)

  const check = async () => {
    setUpdate({ state: 'checking' })
    try {
      const res = await invoke('app:checkUpdate', undefined)
      setUpdate(res)
      if (res.state === 'available') setUpdateDialog(true)
    } catch (e) {
      setUpdate({ state: 'error', error: errorMessage(e) })
    }
  }

  const download = async () => {
    setUpdateDialog(false)
    try {
      await invoke('update:download', undefined)
    } catch (e) {
      toast.error(t('settings.about.update.downloadFailed'), { detail: errorMessage(e) })
    }
  }

  const install = () =>
    void invoke('update:install', undefined).catch((e: unknown) =>
      toast.error(t('settings.about.update.installFailed'), { detail: errorMessage(e) }),
    )

  const exportLogs = async () => {
    setExporting(true)
    try {
      const { path } = await invoke('app:exportLogs', undefined)
      toast.success(t('settings.about.logs.exported'), {
        detail: path,
        action: {
          label: t('settings.about.logs.reveal'),
          onClick: () =>
            void invoke('file:reveal', { path }).catch((e: unknown) =>
              toast.error(t('settings.about.logs.revealFailed'), { detail: errorMessage(e) }),
            ),
        },
      })
    } catch (e) {
      toast.error(t('settings.about.logs.exportFailed'), { detail: errorMessage(e) })
    } finally {
      setExporting(false)
    }
  }

  const version = info.data?.version
  const platformLabel =
    info.data?.platform === 'darwin' ? 'macOS' : info.data?.platform === 'win32' ? 'Windows' : info.data?.platform

  return (
    <>
      <div className="flex flex-col items-center gap-2 py-4">
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="AIWC" className="size-16 rounded-card object-cover" />
        <div className="text-bubble font-medium text-fg">AIWC</div>
        <div className="font-latin text-caption text-fg-3">
          {version
            ? `v${version}${platformLabel ? ` · ${platformLabel}` : ''}${info.data && !info.data.isPackaged ? ` · ${t('settings.about.devBuild')}` : ''}`
            : info.error
              ? t('settings.about.versionFailed')
              : t('settings.about.loading')}
        </div>
      </div>

      <Card variant="rows">
        <SRow
          id="about.update"
          title={t('settings.about.update.title')}
          footer={
            <UpdateFooter
              update={update}
              onRetry={() => void check()}
              onDetail={() => setUpdateDialog(true)}
              onInstall={install}
            />
          }
        >
          {update.state === 'checking' ? (
            <span className="flex items-center gap-2 text-caption text-fg-3">
              <Spinner size={13} /> {t('settings.about.update.checking')}
            </span>
          ) : (
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => void check()}
              // Never a fake 已是最新: a build that cannot update says why instead (no feed, dev build…).
              disabled={unavailable !== null || update.state === 'downloading' || updateState.loading}
              disabledReason={unavailable ? t(UNAVAILABLE_REASON[unavailable]) : undefined}
            >
              {update.state === 'idle' ? t('settings.about.update.check') : t('settings.about.update.recheck')}
            </Button>
          )}
        </SRow>
        <SRow id="about.terms" title={t('settings.about.terms.title')}>
          <Button variant="ghost" onClick={() => setLegal(TERMS)}>
            {t('settings.about.terms.view')}
          </Button>
        </SRow>
        <SRow id="about.privacy" title={t('settings.about.privacy.title')}>
          <Button variant="ghost" onClick={() => setLegal(PRIVACY)}>
            {t('settings.about.privacy.view')}
          </Button>
        </SRow>
        <SRow id="about.logs" title={t('settings.about.logs.title')} description={t('settings.about.logs.description')}>
          <Button variant="ghost" icon={FileText} onClick={() => void exportLogs()} loading={exporting}>
            {t('settings.about.logs.export')}
          </Button>
        </SRow>
      </Card>

      <Dialog open={legal !== null} onOpenChange={(o) => !o && setLegal(null)}>
        <DialogContent size="xl">
          <DialogHeader
            icon={FileText}
            tone="info"
            title={legal ? t(legal.title) : ''}
            description={legal ? t('settings.about.legalUpdated', { date: legal.updated }) : undefined}
          />
          {/* Legal text has one look; the onboarding agreement dialog renders with these same classes. */}
          <DialogBody className="max-h-[52vh] gap-4 pr-1">
            {legal?.sections.map((s) => (
              <section key={s.heading} className="flex flex-col gap-1.5">
                <h3 className="text-body font-medium text-fg">{t(s.heading)}</h3>
                <p className="text-caption leading-5 text-fg-2">{t(s.body)}</p>
              </section>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLegal(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateDialog && update.state === 'available'} onOpenChange={setUpdateDialog}>
        <DialogContent size="lg">
          <DialogHeader
            icon={RefreshCw}
            tone="accent"
            title={t('settings.about.update.dialogTitle', { version: update.version ?? '' })}
            description={t('settings.about.update.dialogDescription', { version: version ?? '' })}
          />
          <DialogFooter actions>
            <Button variant="ghost" onClick={() => setUpdateDialog(false)}>
              {t('settings.about.update.later')}
            </Button>
            <Button icon={Download} onClick={() => void download()}>
              {t('settings.about.update.download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function UpdateFooter({
  update,
  onRetry,
  onDetail,
  onInstall,
}: {
  update: UpdateStatus
  onRetry: () => void
  onDetail: () => void
  onInstall: () => void
}) {
  const t = useT()
  switch (update.state) {
    case 'up_to_date':
      return (
        <InlineHint kind="success">
          {update.version
            ? t('settings.about.update.upToDateVersion', { version: update.version })
            : t('settings.about.update.upToDate')}
        </InlineHint>
      )
    case 'available':
      return (
        <div className="flex min-w-0 items-center gap-2">
          <InlineHint kind="info" truncate>
            {t('settings.about.update.available', { version: update.version ?? '' })}
          </InlineHint>
          <Button variant="link" size="sm" onClick={onDetail}>
            {t('settings.about.update.viewDetails')}
          </Button>
        </div>
      )
    case 'downloading':
      return (
        <div className="flex items-center gap-2">
          <ProgressBar
            value={update.progress !== undefined ? update.progress * 100 : undefined}
            label={t('settings.about.update.downloadProgress')}
            className="w-[160px]"
          />
          <span className="font-latin text-micro tabular-nums text-fg-3">
            {update.progress !== undefined
              ? `${Math.round(update.progress * 100)}%`
              : t('settings.about.update.preparing')}
          </span>
        </div>
      )
    case 'ready':
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InlineHint kind="success" truncate>
            {t('settings.about.update.ready', { version: update.version ?? '' })}
          </InlineHint>
          <Button size="sm" icon={RotateCw} onClick={onInstall}>
            {t('settings.about.update.installNow')}
          </Button>
        </div>
      )
    case 'error':
      return (
        <div className="flex min-w-0 items-center gap-2">
          <InlineHint kind="error" truncate>
            {update.error ?? t('settings.about.update.failed')}
          </InlineHint>
          <Button variant="link" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )
    default:
      return null
  }
}
