/**
 * 导出聊天记录 (Figma 149:415 ⑦): format Select, range radio (current filters / ticked / all), target
 * directory via app:pickDirectory → substrate:export → toast with 打开.
 */
import { Download, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  FormDialog,
  FormDialogField,
  IconButton,
  Input,
  Radio,
  RadioGroup,
  Select,
  toast,
  type SelectOption,
} from '@/kit'
import { useT, type MessageKey } from '@/i18n'
import { invoke } from '@/platform/hooks'
import { openLocalPath } from '@/platform/openExternal'
import { formatNumber } from '@/platform/format'
import {
  computeExportRange,
  defaultExportMode,
  isFiltered,
  rangeLabel,
  type ChatFilters,
  type ExportRangeMode,
} from './filters'

export type ExportFormat = 'html' | 'markdown' | 'json' | 'excel'

const FORMATS: ReadonlyArray<{ value: ExportFormat; label: MessageKey; description: MessageKey }> = [
  {
    value: 'markdown',
    label: 'chat.exportDialog.formats.markdown.label',
    description: 'chat.exportDialog.formats.markdown.description',
  },
  {
    value: 'html',
    label: 'chat.exportDialog.formats.html.label',
    description: 'chat.exportDialog.formats.html.description',
  },
  {
    value: 'json',
    label: 'chat.exportDialog.formats.json.label',
    description: 'chat.exportDialog.formats.json.description',
  },
  {
    value: 'excel',
    label: 'chat.exportDialog.formats.excel.label',
    description: 'chat.exportDialog.formats.excel.description',
  },
]

export interface ExportDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  sessionId: string
  sessionTitle: string
  filters: ChatFilters
  selectedIds: ReadonlySet<string>
  /** Known totals for the radio labels (undefined = unknown). */
  filteredCount?: number
  totalCount?: number
  /** Preferred initial range mode (bar 下载 → filtered/all; selection bar 下载 → selected). */
  initialMode?: ExportRangeMode
}

export function ExportDialog({
  open,
  onOpenChange,
  sessionId,
  sessionTitle,
  filters,
  selectedIds,
  filteredCount,
  totalCount,
  initialMode,
}: ExportDialogProps) {
  const t = useT()
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [mode, setMode] = useState<ExportRangeMode>('all')
  const [outDir, setOutDir] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const filtered = isFiltered(filters)
  const formatOptions = useMemo<ReadonlyArray<SelectOption<ExportFormat>>>(
    () => FORMATS.map((f) => ({ value: f.value, label: t(f.label), description: t(f.description) })),
    [t],
  )

  useEffect(() => {
    if (open) setMode(initialMode ?? defaultExportMode(selectedIds.size, filters))
  }, [open, initialMode, selectedIds.size, filters])

  const options = useMemo(() => {
    const count = (n: number) => t('chat.exportDialog.messageCount', { n, count: formatNumber(n) })
    const out: Array<{ value: ExportRangeMode; label: string; description?: string }> = []
    if (filtered)
      out.push({
        value: 'filtered',
        label: `${t('chat.exportDialog.rangeFiltered')}${filteredCount !== undefined ? ` · ${count(filteredCount)}` : ''}`,
        description:
          rangeLabel(filters.range) +
          (filters.senderIds.length ? ` · ${t('chat.exportDialog.senderCount', { n: filters.senderIds.length })}` : ''),
      })
    if (selectedIds.size > 0)
      out.push({ value: 'selected', label: `${t('chat.exportDialog.rangeSelected')} · ${count(selectedIds.size)}` })
    out.push({ value: 'all', label: `${t('common.all')}${totalCount !== undefined ? ` · ${count(totalCount)}` : ''}` })
    return out
  }, [filtered, filteredCount, filters, selectedIds.size, totalCount, t])

  const pickDir = async () => {
    const dir = await invoke('app:pickDirectory', {
      title: t('chat.exportDialog.pickDirTitle'),
      defaultPath: outDir || undefined,
    })
    if (dir) setOutDir(dir)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const range = computeExportRange(mode, filters, selectedIds)
      const res = await invoke('substrate:export', {
        sessionId,
        format,
        from: range.from,
        to: range.to,
        messageIds: range.messageIds,
        senderIds: range.senderIds,
        outDir: outDir || undefined,
      })
      onOpenChange(false)
      toast.success(t('chat.exportDialog.done', { path: res.path }), {
        action: {
          label: t('common.open'),
          onClick: () => void openLocalPath(res.path, t('chat.openTarget.exportFile')),
        },
      })
    } catch (e) {
      toast.error(t('chat.exportDialog.failed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Download}
      title={t('chat.exportDialog.title')}
      description={t('chat.exportDialog.description', { title: sessionTitle })}
      submitLabel={t('chat.exportDialog.submit')}
      loading={busy}
      onSubmit={submit}
    >
      <FormDialogField label={t('chat.exportDialog.format')}>
        <Select<ExportFormat>
          options={formatOptions}
          value={format}
          onValueChange={setFormat}
          fullWidth
          size="lg"
          aria-label={t('chat.exportDialog.formatLabel')}
        />
      </FormDialogField>
      <FormDialogField label={t('chat.exportDialog.range')} alignTop>
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as ExportRangeMode)}
          aria-label={t('chat.exportDialog.rangeLabel')}
          className="pt-1.5"
        >
          {options.map((o) => (
            <Radio key={o.value} value={o.value} label={o.label} description={o.description} />
          ))}
        </RadioGroup>
      </FormDialogField>
      <FormDialogField label={t('chat.exportDialog.saveTo')}>
        <Input
          mono
          readOnly
          value={outDir}
          placeholder={t('chat.exportDialog.defaultDir')}
          aria-label={t('chat.exportDialog.dirLabel')}
          onClick={() => void pickDir()}
          trailing={
            <IconButton
              size="xs"
              icon={Folder}
              label={t('chat.exportDialog.chooseDir')}
              onClick={() => void pickDir()}
            />
          }
        />
      </FormDialogField>
    </FormDialog>
  )
}
