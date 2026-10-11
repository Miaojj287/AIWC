/**
 * 另存为 CSV for a table in an Agent reply: the kit builds the RFC 4180 text, the main process writes it into the
 * exports folder (file:saveExport, UTF-8 with BOM so Excel reads Chinese), and the toast offers 打开位置.
 */
import { t } from '@/i18n'
import { toast } from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage } from './agentStoreSupport'

export async function saveTableCsv(csv: string): Promise<void> {
  try {
    const { path } = await invoke('file:saveExport', {
      name: t('agent.markdown.tableFileName'),
      ext: 'csv',
      content: csv,
    })
    toast.success(t('agent.markdown.csvSaved'), {
      detail: path,
      action: { label: t('agent.toast.showExport'), onClick: () => void reveal(path) },
    })
  } catch (e) {
    toast.error(t('agent.markdown.csvSaveFailed', { detail: errorMessage(e) }))
  }
}

async function reveal(path: string): Promise<void> {
  try {
    await invoke('file:reveal', { path })
  } catch (e) {
    toast.error(t('common.operationFailedDetail', { detail: errorMessage(e) }))
  }
}
