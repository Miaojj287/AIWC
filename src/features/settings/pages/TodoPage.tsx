/**
 * 设置 › 每日待办 — the opt-in switch with where the chat content goes (CLAUDE.md §6), which group
 * chats are scanned (picked in the 每日待办 object list; removable here), how many messages a scan
 * reads, the schedule (every N hours / daily at a time / manual only) and the model. Every control
 * applies at once; the main process re-arms the schedule when these change.
 */
import { ListTodo, MessagesSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  TODO_DEFAULT_TIME,
  TODO_HOUR_STEPS,
  TODO_MAX_SOURCES,
  TODO_MESSAGE_CAPS,
  TODO_SCHEDULE_KINDS,
  type TodoSchedule,
  type TodoScheduleKind,
} from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Button, Card, Chip, InlineHint, Input, ModelSelect, SegmentedControl, Select, Toggle } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatDateTime } from '@/platform/format'
import { useBridgeEvent, useInvoke } from '@/platform/hooks'
import { saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function scheduleOfKind(kind: TodoScheduleKind, previous: TodoSchedule): TodoSchedule {
  switch (kind) {
    case 'hourly':
      return { kind, everyHours: previous.kind === 'hourly' ? previous.everyHours : 2 }
    case 'daily':
      return { kind, time: previous.kind === 'daily' ? previous.time : TODO_DEFAULT_TIME }
    case 'manual':
      return { kind }
  }
}

export function TodoPage() {
  const t = useT()
  const config = useConfig((c) => c.todo)
  const ai = useConfig((c) => c.ai)
  const defaultModel = ai?.defaultModel
  const models = useInvoke('agent:listModels', undefined, [ai])
  // The next run moves when the schedule changes; the main process also pushes 'todo:changed' then.
  const status = useInvoke('todo:status', undefined, [config?.enabled, config?.schedule, config?.sources.length])
  useBridgeEvent('todo:changed', () => status.reload())

  if (!config) return <PagePlaceholder rows={4} />
  const schedule = config.schedule
  const next = status.data?.nextRunAt
  const scheduleNote =
    !config.enabled || config.sources.length === 0
      ? t('settings.todo.schedule.offHint')
      : schedule.kind === 'manual'
        ? t('settings.todo.schedule.manualHint')
        : next !== undefined
          ? t('settings.todo.schedule.next', { time: formatDateTime(next) })
          : undefined
  const removeSource = (id: string) => void saveConfig({ todo: { sources: config.sources.filter((s) => s.id !== id) } })

  return (
    <>
      <Section title={t('settings.todo.sections.main')}>
        <Card variant="rows">
          <SRow id="todo.enabled" title={t('settings.todo.enabled.title')} htmlFor="todo-enabled">
            <Toggle
              id="todo-enabled"
              checked={config.enabled}
              onCheckedChange={(enabled) => void saveConfig({ todo: { enabled } })}
            />
          </SRow>
          <SRow id="todo.dashboard" title={t('settings.todo.dashboard.title')}>
            <Button variant="outline" size="sm" icon={ListTodo} onClick={() => runCommand('tab.openTodo', {})}>
              {t('settings.todo.dashboard.open')}
            </Button>
          </SRow>
        </Card>
      </Section>

      <Section title={t('settings.todo.sections.scope')}>
        <Card variant="rows">
          <SRow
            id="todo.sources"
            title={t('settings.todo.sources.title')}
            description={
              config.sources.length
                ? t('settings.todo.sources.count', { n: config.sources.length, max: TODO_MAX_SOURCES })
                : t('settings.todo.sources.none')
            }
            footer={
              config.sources.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {config.sources.map((s) => (
                    <Chip
                      key={s.id}
                      variant="mention"
                      icon={MessagesSquare}
                      label={s.title || s.id}
                      title={t('settings.todo.sources.remove', { name: s.title || s.id })}
                      onRemove={() => removeSource(s.id)}
                    />
                  ))}
                </div>
              ) : null
            }
          >
            <Button variant="outline" size="sm" icon={Plus} onClick={() => runCommand('rail.select', { fn: 'todo' })}>
              {t('settings.todo.sources.pick')}
            </Button>
          </SRow>
          <SRow
            id="todo.maxMessages"
            title={t('settings.todo.maxMessages.title')}
            help={t('settings.todo.maxMessages.description')}
          >
            <Select
              aria-label={t('settings.todo.maxMessages.title')}
              options={TODO_MESSAGE_CAPS.map((n) => ({
                value: String(n),
                label: t('settings.todo.maxMessages.option', { n }),
              }))}
              value={String(config.maxMessagesPerSource)}
              onValueChange={(v) => void saveConfig({ todo: { maxMessagesPerSource: Number(v) } })}
              className="min-w-[120px]"
            />
          </SRow>
        </Card>
      </Section>

      <Section title={t('settings.todo.sections.schedule')} help={t('settings.todo.schedule.help')}>
        <Card variant="rows">
          <SRow id="todo.schedule" title={t('settings.todo.schedule.title')} description={scheduleNote}>
            <SegmentedControl
              aria-label={t('settings.todo.schedule.title')}
              options={TODO_SCHEDULE_KINDS.map((kind) => ({
                value: kind,
                label: t(`settings.todo.schedule.kinds.${kind}`),
              }))}
              value={schedule.kind}
              onValueChange={(kind) => void saveConfig({ todo: { schedule: scheduleOfKind(kind, schedule) } })}
            />
          </SRow>
          {schedule.kind === 'hourly' ? (
            <SRow id="todo.interval" title={t('settings.todo.schedule.interval')}>
              <Select
                aria-label={t('settings.todo.schedule.interval')}
                options={TODO_HOUR_STEPS.map((n) => ({
                  value: String(n),
                  label: t('settings.todo.schedule.intervalOption', { n }),
                }))}
                value={String(schedule.everyHours)}
                onValueChange={(v) =>
                  void saveConfig({ todo: { schedule: { kind: 'hourly', everyHours: Number(v) } } })
                }
                className="min-w-[140px]"
              />
            </SRow>
          ) : null}
          {schedule.kind === 'daily' ? <DailyTimeRow key={schedule.time} time={schedule.time} /> : null}
        </Card>
      </Section>

      <Section title={t('settings.todo.sections.model')}>
        <Card variant="rows">
          <SRow
            id="todo.model"
            title={t('settings.todo.model.title')}
            description={t('settings.todo.model.description')}
          >
            <ModelSelect
              models={models.data ?? []}
              value={config.model ?? defaultModel}
              onChange={(model) => void saveConfig({ todo: { model } })}
              onManage={() => runCommand('tab.openSettings', { page: 'ai' })}
            />
          </SRow>
        </Card>
      </Section>
    </>
  )
}

/** Daily time: edited locally, saved on Enter / blur (not on every keystroke of the time field). */
function DailyTimeRow({ time }: { time: string }) {
  const t = useT()
  const [draft, setDraft] = useState(time)
  const valid = TIME_RE.test(draft)
  const commit = () => {
    if (valid && draft !== time) void saveConfig({ todo: { schedule: { kind: 'daily', time: draft } } })
  }
  return (
    <SRow
      id="todo.time"
      title={t('settings.todo.schedule.time')}
      footer={valid ? null : <InlineHint kind="error">{t('settings.todo.schedule.invalidTime')}</InlineHint>}
    >
      <Input
        size="sm"
        type="time"
        mono
        aria-label={t('settings.todo.schedule.time')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        error={!valid}
        className="w-[112px]"
      />
    </SRow>
  )
}
