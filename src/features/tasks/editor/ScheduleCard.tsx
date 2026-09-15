/**
 * 执行时间 — kind (每天 / 每周 / 按间隔 / Cron) as a segmented control, then the fields that kind needs.
 * Figma 184:354's 执行时间 row, as setting rows.
 */
import type { TaskSchedule, TaskScheduleKind } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Card, Chip, InlineHint, Input, SegmentedControl, Select, SettingRow, type SelectOption } from '@/kit'
import {
  describeSchedule,
  INTERVAL_PRESETS,
  scheduleOfKind,
  WEEKDAY_ORDER,
  weekdayLabel,
  type TaskDraftErrors,
} from '../scheduleModel'

export interface ScheduleCardProps {
  schedule: TaskSchedule
  errors: TaskDraftErrors
  onChange(schedule: TaskSchedule): void
}

const KINDS: readonly TaskScheduleKind[] = ['daily', 'weekly', 'interval', 'cron']

export function ScheduleCard({ schedule, errors, onChange }: ScheduleCardProps) {
  const t = useT()
  const intervalOptions: SelectOption<string>[] = [
    ...INTERVAL_PRESETS,
    ...(schedule.kind === 'interval' && !INTERVAL_PRESETS.includes(schedule.everyMinutes)
      ? [schedule.everyMinutes]
      : []),
  ]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: describeSchedule({ kind: 'interval', everyMinutes: n }, t) }))

  return (
    <Card variant="rows">
      <SettingRow title={t('tasks.editor.sectionSchedule')} description={describeSchedule(schedule, t)}>
        <SegmentedControl
          aria-label={t('tasks.editor.sectionSchedule')}
          options={KINDS.map((kind) => ({ value: kind, label: t(`tasks.editor.scheduleKind.${kind}`) }))}
          value={schedule.kind}
          onValueChange={(kind) => onChange(scheduleOfKind(kind, schedule))}
        />
      </SettingRow>

      {schedule.kind === 'daily' || schedule.kind === 'weekly' ? (
        <SettingRow
          title={t('tasks.editor.time')}
          footer={errors.time ? <InlineHint kind="error">{errors.time}</InlineHint> : null}
        >
          <Input
            size="sm"
            type="time"
            mono
            aria-label={t('tasks.editor.time')}
            value={schedule.time}
            onChange={(e) => onChange({ ...schedule, time: e.target.value })}
            error={Boolean(errors.time)}
            className="w-[112px]"
          />
        </SettingRow>
      ) : null}

      {schedule.kind === 'weekly' ? (
        <SettingRow
          title={t('tasks.editor.weekdays')}
          footer={errors.weekdays ? <InlineHint kind="error">{errors.weekdays}</InlineHint> : null}
        >
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('tasks.editor.weekdays')}>
            {WEEKDAY_ORDER.map((day) => {
              const on = schedule.days.includes(day)
              return (
                <Chip
                  key={day}
                  label={weekdayLabel(day, t)}
                  selected={on}
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      ...schedule,
                      days: on ? schedule.days.filter((d) => d !== day) : [...schedule.days, day],
                    })
                  }
                />
              )
            })}
          </div>
        </SettingRow>
      ) : null}

      {schedule.kind === 'interval' ? (
        <SettingRow
          title={t('tasks.editor.interval')}
          footer={errors.interval ? <InlineHint kind="error">{errors.interval}</InlineHint> : null}
        >
          <Select
            aria-label={t('tasks.editor.interval')}
            options={intervalOptions}
            value={String(schedule.everyMinutes)}
            onValueChange={(v) => onChange({ ...schedule, everyMinutes: Number(v) })}
            className="min-w-[160px]"
          />
        </SettingRow>
      ) : null}

      {schedule.kind === 'cron' ? (
        <SettingRow
          title={t('tasks.editor.cron')}
          description={t('tasks.editor.cronDescription')}
          stacked
          footer={errors.cron ? <InlineHint kind="error">{errors.cron}</InlineHint> : null}
        >
          <Input
            mono
            aria-label={t('tasks.editor.cron')}
            placeholder={t('tasks.editor.cronPlaceholder')}
            value={schedule.expression}
            onChange={(e) => onChange({ ...schedule, expression: e.target.value })}
            error={Boolean(errors.cron) && schedule.expression.trim() !== ''}
            spellCheck={false}
          />
        </SettingRow>
      ) : null}
    </Card>
  )
}
