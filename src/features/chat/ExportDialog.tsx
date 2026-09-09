/**
 * 导出聊天记录 (Figma 149:415 ⑦): format Select, range radio (current filters / ticked / all), target
 * directory via app:pickDirectory → substrate:export → toast with 打开.
 */
import { Download, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FormDialog, FormDialogField, IconButton, Input, Radio, RadioGroup, Select, toast, type SelectOption } from '@/kit'
import { invoke } from '@/platform/hooks'
import { openLocalPath } from '@/platform/openExternal'
import { formatNumber } from '@/platform/format'
import { computeExportRange, defaultExportMode, isFiltered, rangeLabel, type ChatFilters, type ExportRangeMode } from './filters'

export type ExportFormat = 'html' | 'markdown' | 'json' | 'excel'

const FORMATS: ReadonlyArray<SelectOption<ExportFormat>> = [
  { value: 'markdown', label: 'Markdown', description: '纯文本，适合再交给 Agent 或归档' },
  { value: 'html', label: 'HTML 网页', description: '带样式与媒体的单文件网页' },
  { value: 'json', label: 'JSON', description: '结构化数据，供程序处理' },
  { value: 'excel', label: 'Excel 表格', description: '每条消息一行' },
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

export function ExportDialog({ open, onOpenChange, sessionId, sessionTitle, filters, selectedIds, filteredCount, totalCount, initialMode }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [mode, setMode] = useState<ExportRangeMode>('all')
  const [outDir, setOutDir] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const filtered = isFiltered(filters)

  useEffect(() => {
    if (open) setMode(initialMode ?? defaultExportMode(selectedIds.size, filters))
  }, [open, initialMode, selectedIds.size, filters])

  const options = useMemo(() => {
    const out: Array<{ value: ExportRangeMode; label: string; description?: string }> = []
    if (filtered) out.push({ value: 'filtered', label: `当前筛选${filteredCount !== undefined ? ` · ${formatNumber(filteredCount)} 条` : ''}`, description: rangeLabel(filters.range) + (filters.senderIds.length ? ` · ${filters.senderIds.length} 位发送者` : '') })
    if (selectedIds.size > 0) out.push({ value: 'selected', label: `已勾选 · ${formatNumber(selectedIds.size)} 条` })
    out.push({ value: 'all', label: `全部${totalCount !== undefined ? ` · ${formatNumber(totalCount)} 条` : ''}` })
    return out
  }, [filtered, filteredCount, filters, selectedIds.size, totalCount])

  const pickDir = async () => {
    const dir = await invoke('app:pickDirectory', { title: '选择导出目录', defaultPath: outDir || undefined })
    if (dir) setOutDir(dir)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const range = computeExportRange(mode, filters, selectedIds)
      const res = await invoke('substrate:export', { sessionId, format, from: range.from, to: range.to, messageIds: range.messageIds, outDir: outDir || undefined })
      onOpenChange(false)
      toast.success(`已导出到 ${res.path}`, { action: { label: '打开', onClick: () => void openLocalPath(res.path, '导出文件') } })
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Download}
      title="导出聊天记录"
      description={`${sessionTitle} · 图片与文件会一并复制到导出目录，全部在本机完成`}
      submitLabel="导出"
      loading={busy}
      onSubmit={submit}
    >
      <FormDialogField label="格式">
        <Select<ExportFormat> options={FORMATS} value={format} onValueChange={setFormat} fullWidth size="lg" aria-label="导出格式" />
      </FormDialogField>
      <FormDialogField label="范围" alignTop>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as ExportRangeMode)} aria-label="导出范围" className="pt-1.5">
          {options.map((o) => (
            <Radio key={o.value} value={o.value} label={o.label} description={o.description} />
          ))}
        </RadioGroup>
      </FormDialogField>
      <FormDialogField label="保存到">
        <Input
          mono
          readOnly
          value={outDir}
          placeholder="默认：下载目录"
          aria-label="导出目录"
          onClick={() => void pickDir()}
          trailing={<IconButton size="xs" icon={Folder} label="选择目录" onClick={() => void pickDir()} />}
        />
      </FormDialogField>
    </FormDialog>
  )
}
