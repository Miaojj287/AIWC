/**
 * Date-range filter of the sync bar: a Select with the presets (今天 / 最近 7 天 / 最近 30 天 / 全部 / 自定义);
 * picking 自定义 opens a popover with two date inputs + 重置 / 应用 (Figma 149:415 ⑤ 日期范围).
 */
import { Calendar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Input, Popover, PopoverAnchor, PopoverContent, Select, type SelectOption } from '@/kit'
import { useT } from '@/i18n'
import {
  RANGE_PRESETS,
  rangeLabel,
  toDateInput,
  validateCustomRange,
  type DateRange,
  type DateRangePreset,
} from './filters'

type Choice = DateRangePreset | 'custom'

export interface DateRangeFilterProps {
  range: DateRange
  onChange(range: DateRange): void
}

export function DateRangeFilter({ range, onChange }: DateRangeFilterProps) {
  const t = useT()
  const options = useMemo<ReadonlyArray<SelectOption<Choice>>>(
    () => [
      ...RANGE_PRESETS.map((p) => ({
        value: p.value,
        label: t(p.labelKey),
        description: p.descriptionKey ? t(p.descriptionKey) : undefined,
      })),
      { value: 'custom', label: t('chat.dateRange.custom'), icon: Calendar },
    ],
    [t],
  )
  const [customOpen, setCustomOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | undefined>()

  const openCustom = () => {
    const now = Date.now()
    setFrom(range.preset === 'custom' ? toDateInput(range.from) : toDateInput(now - 6 * 86_400_000))
    setTo(range.preset === 'custom' ? toDateInput(range.to) : toDateInput(now))
    setError(undefined)
    setCustomOpen(true)
  }

  const apply = () => {
    const v = validateCustomRange(from, to)
    if (!v.ok) {
      setError(v.error)
      return
    }
    onChange({ preset: 'custom', from: v.from, to: v.to })
    setCustomOpen(false)
  }

  return (
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Select<Choice>
            options={options}
            value={range.preset}
            aria-label={t('chat.dateRange.label')}
            align="end"
            renderValue={() => rangeLabel(range)}
            onValueChange={(v) => {
              if (v === 'custom') openCustom()
              else onChange({ preset: v })
            }}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-[300px]">
        <div className="flex flex-col gap-2.5">
          <div className="text-body font-medium text-fg">{t('chat.dateRange.customTitle')}</div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label={t('chat.dateRange.start')}
              mono
              size="sm"
              className="flex-1"
            />
            <span className="text-caption text-fg-3">{t('chat.dateRange.separator')}</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label={t('chat.dateRange.end')}
              mono
              size="sm"
              className="flex-1"
            />
          </div>
          {error ? <div className="text-note text-danger">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange({ preset: 'all' })
                setCustomOpen(false)
              }}
            >
              {t('common.reset')}
            </Button>
            <Button size="sm" onClick={apply}>
              {t('chat.dateRange.apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
