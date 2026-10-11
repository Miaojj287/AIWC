/**
 * 设置 › 数据 — what AIWC keeps on this computer, per category (storage:usage), clearing the caches that
 * are rebuilt on demand (storage:clear: plaintext database copies, image / file cache, old logs), and
 * 清除全部数据 (storage:wipeAll: type-to-confirm, then the app relaunches into onboarding).
 */
import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  CLEARABLE_STORAGE_CATEGORIES,
  type ClearableStorageCategory,
  type StorageCategory,
  type StorageCategoryUsage,
} from '@aiwc/protocol'
import { Button, Card, ConfirmDialog, DangerDialog, EmptyState, IconButton, toast } from '@/kit'
import { useT } from '@/i18n'
import { formatBytes } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import { openLocalPath } from '@/platform/openExternal'
import { errorMessage } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'

const CLEARABLE = new Set<StorageCategory>(CLEARABLE_STORAGE_CATEGORIES)

/** Catalog keys per category (title + one-line description). */
const CATEGORY_COPY = {
  index: ['settings.data.categories.index.title', 'settings.data.categories.index.description'],
  plaintext: ['settings.data.categories.plaintext.title', 'settings.data.categories.plaintext.description'],
  media: ['settings.data.categories.media.title', 'settings.data.categories.media.description'],
  conversations: ['settings.data.categories.conversations.title', 'settings.data.categories.conversations.description'],
  memory: ['settings.data.categories.memory.title', 'settings.data.categories.memory.description'],
  features: ['settings.data.categories.features.title', 'settings.data.categories.features.description'],
  skills: ['settings.data.categories.skills.title', 'settings.data.categories.skills.description'],
  pets: ['settings.data.categories.pets.title', 'settings.data.categories.pets.description'],
  workspace: ['settings.data.categories.workspace.title', 'settings.data.categories.workspace.description'],
  exports: ['settings.data.categories.exports.title', 'settings.data.categories.exports.description'],
  logs: ['settings.data.categories.logs.title', 'settings.data.categories.logs.description'],
  other: ['settings.data.categories.other.title', 'settings.data.categories.other.description'],
} as const satisfies Record<StorageCategory, readonly [string, string]>

const CLEAR_COPY = {
  plaintext: ['settings.data.clear.plaintext.title', 'settings.data.clear.plaintext.description'],
  media: ['settings.data.clear.media.title', 'settings.data.clear.media.description'],
  logs: ['settings.data.clear.logs.title', 'settings.data.clear.logs.description'],
} as const satisfies Record<ClearableStorageCategory, readonly [string, string]>

/** Search-index row ids of the clearable rows (settings search jumps here). */
const CLEAR_ROW_ID = { plaintext: 'data.plaintext', media: 'data.media', logs: 'data.logs' } as const

export function DataPage() {
  const t = useT()
  const usage = useInvoke('storage:usage', undefined, [])
  const [pending, setPending] = useState<ClearableStorageCategory | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)

  const clear = async (category: ClearableStorageCategory) => {
    try {
      const { freedBytes } = await invoke('storage:clear', { category })
      toast.success(t('settings.data.clear.done', { size: formatBytes(freedBytes) }))
      setPending(null)
      usage.reload()
    } catch (e) {
      toast.error(t('settings.data.clear.failed'), { detail: errorMessage(e) })
    }
  }

  const wipe = async () => {
    try {
      // The app quits and relaunches into onboarding; nothing more happens on this page.
      await invoke('storage:wipeAll', undefined)
    } catch (e) {
      toast.error(t('settings.data.wipe.failed'), { detail: errorMessage(e) })
    }
  }

  const data = usage.data
  const sizeRow = (c: StorageCategoryUsage) => (
    <span className="whitespace-nowrap font-latin text-caption tabular-nums text-fg-2">{formatBytes(c.bytes)}</span>
  )
  const kept = data?.categories.filter((c) => !CLEARABLE.has(c.id)) ?? []
  const clearable = data?.categories.filter((c): c is StorageCategoryUsage & { id: ClearableStorageCategory } =>
    CLEARABLE.has(c.id),
  )

  return (
    <>
      <Section
        id="data.usage"
        title={t('settings.data.sections.usage')}
        aside={
          data
            ? data.categories.some((c) => c.partial)
              ? t('settings.data.partial')
              : t('settings.data.total', { size: formatBytes(data.totalBytes) })
            : undefined
        }
        actions={
          <>
            <IconButton
              icon={FolderOpen}
              size="sm"
              label={t('settings.data.openFolder')}
              disabled={!data}
              onClick={() => data && void openLocalPath(data.dataRoot, t('settings.data.openFolder'))}
            />
            <IconButton
              icon={RefreshCw}
              size="sm"
              label={t('settings.data.refresh')}
              loading={usage.loading}
              onClick={() => usage.reload()}
            />
          </>
        }
      >
        {usage.error ? (
          <EmptyState
            bordered
            variant="error"
            title={t('settings.data.loadFailed')}
            description={usage.error.message}
            action={{ label: t('common.retry'), onClick: () => usage.reload() }}
          />
        ) : !data ? (
          <PagePlaceholder rows={4} />
        ) : (
          <Card variant="rows">
            {kept.map((c) => (
              <SRow
                key={c.id}
                id={`data.category.${c.id}`}
                title={t(CATEGORY_COPY[c.id][0])}
                description={t(CATEGORY_COPY[c.id][1])}
              >
                {sizeRow(c)}
              </SRow>
            ))}
          </Card>
        )}
      </Section>

      <Section title={t('settings.data.sections.clean')}>
        {!data ? (
          usage.error ? null : (
            <PagePlaceholder rows={3} />
          )
        ) : (
          <Card variant="rows">
            {clearable?.map((c) => (
              <SRow
                key={c.id}
                id={CLEAR_ROW_ID[c.id]}
                title={t(CATEGORY_COPY[c.id][0])}
                description={t(CATEGORY_COPY[c.id][1])}
              >
                <div className="flex items-center gap-3">
                  {sizeRow(c)}
                  <Button
                    variant="outline"
                    icon={Trash2}
                    disabled={c.bytes === 0}
                    disabledReason={t('settings.data.clear.empty')}
                    onClick={() => setPending(c.id)}
                  >
                    {t('settings.data.clear.action')}
                  </Button>
                </div>
              </SRow>
            ))}
          </Card>
        )}
      </Section>

      <Section title={t('settings.data.sections.danger')}>
        <Card variant="rows">
          <SRow id="data.wipe" title={t('settings.data.wipe.title')} description={t('settings.data.wipe.description')}>
            <Button variant="outline" icon={Trash2} onClick={() => setWipeOpen(true)}>
              {t('settings.data.wipe.action')}
            </Button>
          </SRow>
        </Card>
      </Section>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        icon={Trash2}
        tone="warn"
        title={pending ? t(CLEAR_COPY[pending][0]) : ''}
        description={pending ? t(CLEAR_COPY[pending][1]) : undefined}
        confirmLabel={t('settings.data.clear.confirm')}
        onConfirm={() => (pending ? clear(pending) : undefined)}
      />

      <DangerDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title={t('settings.data.wipe.dialogTitle')}
        description={t('settings.data.wipe.dialogDescription')}
        confirmWord={t('settings.data.wipe.word')}
        confirmLabel={t('settings.data.wipe.confirm')}
        onConfirm={wipe}
      />
    </>
  )
}
