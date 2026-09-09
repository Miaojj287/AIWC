/**
 * 本地语音模型列表 (Figma 128:926): download with progress + cancel, delete (confirm), set default.
 * Polls ai:listLocalSttModels while a download runs.
 */
import { Check, Download, Mic, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, DangerDialog, EmptyState, ICON_STROKE, IconButton, ProgressBar, SettingRow, toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'

type SttModel = Awaited<ReturnType<typeof invoke<'ai:listLocalSttModels'>>>[number]

export function SttLocalList() {
  const models = useInvoke('ai:listLocalSttModels', undefined, [])
  const [pendingDelete, setPendingDelete] = useState<SttModel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const downloading = (models.data ?? []).some((m) => m.state === 'downloading')

  useEffect(() => {
    if (!downloading) return
    const t = setInterval(() => models.reload(), 600)
    return () => clearInterval(t)
  }, [downloading, models.reload])

  const act = async (id: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(id)
    try {
      await fn()
      if (okText) toast.success(okText)
      models.reload()
    } catch (e) {
      toast.error('操作失败', { detail: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  if (models.loading && !models.data) return <div className="px-4 py-3 text-caption text-fg-3">读取本地模型…</div>
  if (models.error) return <EmptyState compact variant="error" title="读取本地模型失败" description={models.error.message} action={{ label: '重试', onClick: models.reload }} />
  const list = models.data ?? []
  if (list.length === 0) return <EmptyState compact variant="empty" title="没有可用的本地模型" description="当前版本未内置离线转写模型" />

  return (
    <>
      {list.map((m) => {
        const stateText = m.state === 'ready' ? '已下载' : m.state === 'downloading' ? `下载中 ${Math.round((m.progress ?? 0) * 100)}%` : '未下载'
        return (
          <SettingRow
            key={m.id}
            data-setting-row="ai.sttLocal"
            title={
              <span className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-control bg-line-6 text-fg-3">
                  <Mic size={13} strokeWidth={ICON_STROKE} aria-hidden />
                </span>
                {m.label}
              </span>
            }
            badge={m.isDefault ? <Badge tone="ok">使用中</Badge> : null}
            description={`${m.sizeMb} MB · ${stateText}`}
          >
            {m.state === 'absent' ? (
              <Button variant="ghost" icon={Download} loading={busy === m.id} onClick={() => void act(m.id, () => invoke('ai:downloadSttModel', { id: m.id }))}>
                下载
              </Button>
            ) : null}
            {m.state === 'downloading' ? (
              <>
                <ProgressBar value={(m.progress ?? 0) * 100} label={`${m.label} 下载进度`} className="w-[120px]" />
                <span className="font-latin text-micro tabular-nums text-fg-3">{Math.round((m.progress ?? 0) * 100)}%</span>
                <Button variant="ghost" size="sm" onClick={() => void act(m.id, () => invoke('ai:cancelSttDownload', { id: m.id }), '已取消下载')}>
                  取消
                </Button>
              </>
            ) : null}
            {m.state === 'ready' && !m.isDefault ? (
              <>
                <Button variant="ghost" icon={Check} loading={busy === m.id} onClick={() => void act(m.id, () => invoke('ai:setDefaultSttModel', { id: m.id }), `已将 ${m.label} 设为默认`)}>
                  设为默认
                </Button>
                <IconButton icon={Trash} label={`删除 ${m.label}`} tone="danger" onClick={() => setPendingDelete(m)} />
              </>
            ) : null}
          </SettingRow>
        )
      })}
      <DangerDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`删除 ${pendingDelete?.label ?? ''}？`}
        description={`将从磁盘移除约 ${pendingDelete?.sizeMb ?? 0} MB 模型文件；需要时可以重新下载。`}
        onConfirm={async () => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) await act(target.id, () => invoke('ai:deleteSttModel', { id: target.id }), `已删除 ${target.label}`)
        }}
      />
    </>
  )
}
