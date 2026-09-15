/**
 * 本地语音模型列表 (Figma 128:926): download with progress + cancel, delete (confirm), set default.
 * Polls ai:listLocalSttModels while a download runs.
 */
import { Check, Download, Mic, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { Badge, Button, DangerDialog, EmptyState, ICON_STROKE, IconButton, ProgressBar, SettingRow, toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'

type SttModel = Awaited<ReturnType<typeof invoke<'ai:listLocalSttModels'>>>[number]

export function SttLocalList() {
  const t = useT()
  const models = useInvoke('ai:listLocalSttModels', undefined, [])
  const [pendingDelete, setPendingDelete] = useState<SttModel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const downloading = (models.data ?? []).some((m) => m.state === 'downloading')
  const reloadModels = models.reload

  useEffect(() => {
    if (!downloading) return
    const t = setInterval(reloadModels, 600)
    return () => clearInterval(t)
  }, [downloading, reloadModels])

  const act = async (id: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(id)
    try {
      await fn()
      if (okText) toast.success(okText)
      models.reload()
    } catch (e) {
      toast.error(t('common.operationFailed'), { detail: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  if (models.loading && !models.data)
    return <div className="px-4 py-3 text-caption text-fg-3">{t('settings.ai.sttLocal.loading')}</div>
  if (models.error)
    return (
      <EmptyState
        compact
        variant="error"
        title={t('settings.ai.sttLocal.loadFailed')}
        description={models.error.message}
        action={{ label: t('common.retry'), onClick: models.reload }}
      />
    )
  const list = models.data ?? []
  if (list.length === 0)
    return (
      <EmptyState
        compact
        variant="empty"
        title={t('settings.ai.sttLocal.empty')}
        description={t('settings.ai.sttLocal.emptyDescription')}
      />
    )

  return (
    <>
      {list.map((m) => {
        const stateText =
          m.state === 'ready'
            ? t('settings.ai.sttLocal.ready')
            : m.state === 'downloading'
              ? t('settings.ai.sttLocal.downloading', { percent: Math.round((m.progress ?? 0) * 100) })
              : t('settings.ai.sttLocal.absent')
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
            badge={m.isDefault ? <Badge tone="ok">{t('settings.ai.sttLocal.inUse')}</Badge> : null}
            description={`${m.sizeMb} MB · ${stateText}`}
          >
            {m.state === 'absent' ? (
              <Button
                variant="ghost"
                icon={Download}
                loading={busy === m.id}
                onClick={() => void act(m.id, () => invoke('ai:downloadSttModel', { id: m.id }))}
              >
                {t('settings.ai.sttLocal.download')}
              </Button>
            ) : null}
            {m.state === 'downloading' ? (
              <>
                <ProgressBar
                  value={(m.progress ?? 0) * 100}
                  label={t('settings.ai.sttLocal.progress', { name: m.label })}
                  className="w-[120px]"
                />
                <span className="font-latin text-micro tabular-nums text-fg-3">
                  {Math.round((m.progress ?? 0) * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void act(
                      m.id,
                      () => invoke('ai:cancelSttDownload', { id: m.id }),
                      t('settings.ai.sttLocal.downloadCanceled'),
                    )
                  }
                >
                  {t('common.cancel')}
                </Button>
              </>
            ) : null}
            {m.state === 'ready' && !m.isDefault ? (
              <>
                <Button
                  variant="ghost"
                  icon={Check}
                  loading={busy === m.id}
                  onClick={() =>
                    void act(
                      m.id,
                      () => invoke('ai:setDefaultSttModel', { id: m.id }),
                      t('settings.ai.sttLocal.defaultSet', { name: m.label }),
                    )
                  }
                >
                  {t('settings.ai.sttLocal.setDefault')}
                </Button>
                <IconButton
                  icon={Trash}
                  label={t('settings.ai.sttLocal.deleteModel', { name: m.label })}
                  tone="danger"
                  onClick={() => setPendingDelete(m)}
                />
              </>
            ) : null}
          </SettingRow>
        )
      })}
      <DangerDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={t('settings.ai.sttLocal.deleteTitle', { name: pendingDelete?.label ?? '' })}
        description={t('settings.ai.sttLocal.deleteDescription', { size: pendingDelete?.sizeMb ?? 0 })}
        onConfirm={async () => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target)
            await act(
              target.id,
              () => invoke('ai:deleteSttModel', { id: target.id }),
              t('settings.ai.sttLocal.deleted', { name: target.label }),
            )
        }}
      />
    </>
  )
}
