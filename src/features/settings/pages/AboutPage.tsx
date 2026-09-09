/**
 * 版本与支持 — version block, 检查更新 state machine (app:checkUpdate + 'app:update'), 协议 / 隐私 dialogs
 * and 导出日志 with a 定位文件 toast action. Figma 128:1854, board 151:415 ⑥.
 */
import { FileText, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { UpdateStatus } from '@aiwc/protocol'
import { Button, Card, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, ICON_STROKE, InlineHint, ProgressBar, Spinner, toast } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'
import { PRIVACY, TERMS, type LegalDoc } from '../legalText'
import { SRow } from '../pageKit'

export function AboutPage() {
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
      toast.success('已导出日志', { detail: path, action: { label: '定位文件', onClick: () => void invoke('file:reveal', { path }).catch((e: unknown) => toast.error('无法定位文件', { detail: errorMessage(e) })) } })
    } catch (e) {
      toast.error('导出日志失败', { detail: errorMessage(e) })
    } finally {
      setExporting(false)
    }
  }

  const version = info.data?.version
  const platformLabel = info.data?.platform === 'darwin' ? 'macOS' : info.data?.platform === 'win32' ? 'Windows' : info.data?.platform

  return (
    <>
      <div className="flex flex-col items-center gap-2 py-4">
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="AIWC" className="size-16 rounded-card object-cover" />
        <div className="text-bubble font-medium text-fg">AIWC</div>
        <div className="font-latin text-caption text-fg-3">{version ? `v${version}${platformLabel ? ` · ${platformLabel}` : ''}${info.data && !info.data.isPackaged ? ' · 开发版' : ''}` : info.error ? '版本信息读取失败' : '读取中…'}</div>
      </div>

      <Card variant="rows">
        <SRow id="about.update" title="检查更新" description="查看当前版本是否可更新" footer={<UpdateFooter update={update} onRetry={() => void check()} onDetail={() => setUpdateDialog(true)} />}>
          {update.state === 'checking' ? (
            <span className="flex items-center gap-2 text-caption text-fg-3">
              <Spinner size={13} /> 检查中…
            </span>
          ) : (
            <Button variant="ghost" icon={RefreshCw} onClick={() => void check()} disabled={update.state === 'downloading'}>
              {update.state === 'idle' ? '检查更新' : '重新检查'}
            </Button>
          )}
        </SRow>
        <SRow id="about.terms" title="用户服务协议" description={`查看《${TERMS.title}》`}>
          <Button variant="ghost" onClick={() => setLegal(TERMS)}>
            查看协议
          </Button>
        </SRow>
        <SRow id="about.privacy" title="隐私政策" description={`查看《${PRIVACY.title}》`}>
          <Button variant="ghost" onClick={() => setLegal(PRIVACY)}>
            查看政策
          </Button>
        </SRow>
        <SRow id="about.logs" title="日志" description="导出日志，便于问题反馈；日志不包含聊天内容">
          <Button variant="ghost" icon={FileText} onClick={() => void exportLogs()} loading={exporting}>
            导出日志
          </Button>
        </SRow>
      </Card>

      <Dialog open={legal !== null} onOpenChange={(o) => !o && setLegal(null)}>
        <DialogContent size="xl">
          <DialogHeader icon={FileText} tone="info" title={legal?.title ?? ''} description={legal ? `更新于 ${legal.updated}` : undefined} />
          <DialogBody className="max-h-[52vh] pr-1">
            {legal?.sections.map((s) => (
              <div key={s.heading} className="flex flex-col gap-1">
                <div className="text-tab font-medium text-fg">{s.heading}</div>
                <p className="text-caption leading-[18px] text-fg-2">{s.body}</p>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLegal(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateDialog && update.state === 'available'} onOpenChange={setUpdateDialog}>
        <DialogContent size="lg">
          <DialogHeader icon={RefreshCw} tone="accent" title={`AIWC v${update.version ?? ''} 可用`} description={`当前 v${version ?? ''}。下载会在后台进行，完成后会提示你重启安装。`} />
          <DialogBody>
            <InlineHint kind="info">更新包由应用自动下载与校验；下载进度会显示在本页。</InlineHint>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateDialog(false)}>
              稍后
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function UpdateFooter({ update, onRetry, onDetail }: { update: UpdateStatus; onRetry: () => void; onDetail: () => void }) {
  switch (update.state) {
    case 'up_to_date':
      return <InlineHint kind="success">已是最新版本{update.version ? ` v${update.version}` : ''}</InlineHint>
    case 'available':
      return (
        <div className="flex items-center gap-2">
          <InlineHint kind="info">发现新版本 v{update.version}</InlineHint>
          <Button variant="link" size="sm" onClick={onDetail}>
            查看详情
          </Button>
        </div>
      )
    case 'downloading':
      return (
        <div className="flex items-center gap-2">
          <ProgressBar value={update.progress !== undefined ? update.progress * 100 : undefined} label="下载进度" className="w-[160px]" />
          <span className="font-latin text-micro tabular-nums text-fg-3">{update.progress !== undefined ? `${Math.round(update.progress * 100)}%` : '准备下载…'}</span>
        </div>
      )
    case 'ready':
      return <InlineHint kind="success">v{update.version} 已下载，重启应用后完成安装</InlineHint>
    case 'error':
      return (
        <div className="flex items-center gap-2">
          <InlineHint kind="error">{update.error ?? '检查更新失败'}</InlineHint>
          <Button variant="link" size="sm" onClick={onRetry}>
            重试
          </Button>
        </div>
      )
    default:
      return null
  }
}
