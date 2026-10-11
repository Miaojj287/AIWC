/**
 * 导出会话: format plus what goes into the file. Every switch starts on the privacy-safe side — tool inputs and
 * results (WeChat chat text) and reasoning are left out, identifiers are redacted — and the user opts in.
 */
import { Download } from 'lucide-react'
import { useState } from 'react'
import { SAFE_THREAD_EXPORT, type ThreadExportOptions } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { FormDialog, FormDialogField, SegmentedControl, SettingRow, Toggle } from '@/kit'

export interface ThreadExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (options: ThreadExportOptions) => Promise<void> | void
}

type Switch = 'includeToolOutputs' | 'includeReasoning' | 'redactIdentifiers'

const SWITCHES = [
  {
    key: 'includeToolOutputs',
    title: 'agent.exportDialog.includeToolOutputs',
    hint: 'agent.exportDialog.includeToolOutputsHint',
  },
  {
    key: 'includeReasoning',
    title: 'agent.exportDialog.includeReasoning',
    hint: 'agent.exportDialog.includeReasoningHint',
  },
  {
    key: 'redactIdentifiers',
    title: 'agent.exportDialog.redactIdentifiers',
    hint: 'agent.exportDialog.redactIdentifiersHint',
  },
] as const satisfies ReadonlyArray<{ key: Switch; title: string; hint: string }>

export function ThreadExportDialog({ open, onOpenChange, onExport }: ThreadExportDialogProps) {
  const t = useT()
  // Remounted per opening (ThreadDialogs keys it), so every export starts from the safe defaults.
  const [options, setOptions] = useState<ThreadExportOptions>(SAFE_THREAD_EXPORT)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Download}
      title={t('agent.exportDialog.title')}
      description={t('agent.exportDialog.description')}
      submitLabel={t('agent.exportDialog.confirm')}
      onSubmit={() => onExport(options)}
    >
      <div className="flex flex-col gap-3">
        <FormDialogField label={t('agent.exportDialog.format')}>
          <SegmentedControl<ThreadExportOptions['format']>
            aria-label={t('agent.exportDialog.format')}
            value={options.format}
            onValueChange={(format) => setOptions((o) => ({ ...o, format }))}
            options={[
              { value: 'md', label: t('agent.exportDialog.formatMarkdown') },
              { value: 'json', label: t('agent.exportDialog.formatJson') },
            ]}
          />
        </FormDialogField>
        <div className="flex flex-col">
          {SWITCHES.map((row) => (
            <SettingRow key={row.key} title={t(row.title)} description={t(row.hint)} className="px-0">
              <Toggle
                label={t(row.title)}
                checked={options[row.key]}
                onCheckedChange={(checked) => setOptions((o) => ({ ...o, [row.key]: checked }))}
              />
            </SettingRow>
          ))}
        </div>
      </div>
    </FormDialog>
  )
}
