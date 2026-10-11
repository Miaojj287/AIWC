/** 到时做什么 — run the agent with the instructions, or only remind (notify with the text, no model). */
import type { TaskAction } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { SegmentedControl, SettingRow } from '@/kit'

const ACTIONS: readonly TaskAction[] = ['agent', 'remind']

export function ActionRow({ value, onChange }: { value: TaskAction; onChange(action: TaskAction): void }) {
  const t = useT()
  return (
    <SettingRow title={t('tasks.editor.action')} help={t('tasks.editor.actionDescription')}>
      <SegmentedControl
        aria-label={t('tasks.editor.action')}
        options={ACTIONS.map((action) => ({ value: action, label: t(`tasks.editor.actionKind.${action}`) }))}
        value={value}
        onValueChange={onChange}
      />
    </SettingRow>
  )
}
