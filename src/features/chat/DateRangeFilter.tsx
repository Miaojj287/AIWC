/**
 * Date-range filter of the sync bar: a Select with the presets (今天 / 最近 7 天 / 最近 30 天 / 全部 / 自定义);
 * picking 自定义 opens a popover with two date inputs + 重置 / 应用 (Figma 149:415 ⑤ 日期范围).
 */
import { Calendar } from 'lucide-react'
import { useState } from 'react'
import { Button, Input, Popover, PopoverAnchor, PopoverContent, Select, type SelectOption } from '@/kit'
import { RANGE_PRESETS, rangeLabel, toDateInput, validateCustomRange, type DateRange, type DateRangePreset } from './filters'

type Choice = DateRangePreset | 'custom'

const OPTIONS: ReadonlyArray<SelectOption<Choice>> = [
  ...RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label, description: p.description })),
  { value: 'custom', label: '自定义…', description: '选择起止日期', icon: Calendar },
]

export interface DateRangeFilterProps {
  range: DateRange
  onChange(range: DateRange): void
}

export function DateRangeFilter({ range, onChange }: DateRangeFilterProps) {
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
            options={OPTIONS}
            value={range.preset}
            aria-label="日期范围"
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
          <div className="text-body font-medium text-fg">自定义范围</div>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="开始日期" mono size="sm" className="flex-1" />
            <span className="text-caption text-fg-3">至</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="结束日期" mono size="sm" className="flex-1" />
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
              重置
            </Button>
            <Button size="sm" onClick={apply}>
              应用
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
