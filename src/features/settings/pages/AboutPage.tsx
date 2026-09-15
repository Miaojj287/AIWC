/**
 * 版本与支持 — version block, 检查更新 state machine (app:checkUpdate + 'app:update'), 协议 / 隐私 dialogs
 * and 导出日志 with a 定位文件 toast action. Figma 128:1854, board 151:415 ⑥.
 */
import { FileText, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { UpdateStatus } from '@aiwc/protocol'
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

export function AboutPage() {
  const t = useT()
  const info = useInvoke('app:getInfo', undefined, [])
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
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
          footer={<UpdateFooter update={update} onRetry={() => void check()} onDetail={() => setUpdateDialog(true)} />}
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
              disabled={update.state === 'downloading'}
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
          <DialogBody className="max-h-[52vh] pr-1">
            {legal?.sections.map((s) => (
              <div key={s.heading} className="flex flex-col gap-1">
                <div className="text-tab font-medium text-fg">{t(s.heading)}</div>
                <p className="text-caption leading-[18px] text-fg-2">{t(s.body)}</p>
              </div>
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateDialog(false)}>
              {t('settings.about.update.later')}
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
}: {
  update: UpdateStatus
  onRetry: () => void
  onDetail: () => void
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
        <InlineHint kind="success">{t('settings.about.update.ready', { version: update.version ?? '' })}</InlineHint>
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
