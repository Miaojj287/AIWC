/**
 * Per-model settings popover behind the ✎ on a model row (Figma 164:3520): 推理强度 / 快速 / 上下文用量,
 * plus 移除此模型 at the bottom. Every change writes through immediately (DESIGN-SPEC §2 生效时机).
 */
import { Pencil, Trash } from 'lucide-react'
import { useState } from 'react'
import { modelCapabilities, type ProviderConfig, type ModelEntry, type ReasoningEffort } from '@aiwc/protocol'
import { Button, DangerDialog, Divider, IconButton, Popover, PopoverContent, PopoverTrigger, Select, Input, Toggle, cn, type SelectOption } from '@/kit'
import { CONTEXT_WINDOWS, REASONING_EFFORTS, formatContext } from '../../aiModel'

export interface ModelSettingsPopoverProps {
  provider: Pick<ProviderConfig, 'kind'>
  model: ModelEntry
  onPatch: (patch: Partial<ModelEntry>) => void
  onRemove: () => void
  disabled?: boolean
}

const EFFORT_DEFAULT = '__default' as const
type EffortValue = ReasoningEffort | typeof EFFORT_DEFAULT

const EFFORT_OPTIONS: SelectOption<EffortValue>[] = [
  { value: EFFORT_DEFAULT, label: '默认', description: '由服务商决定' },
  ...REASONING_EFFORTS.map((e) => ({ value: e.value, label: e.label, description: e.description })),
]


const ROW = 'flex h-8 items-center gap-2 rounded-control px-2'
const LABEL = 'min-w-0 flex-1 text-caption text-fg-3'
const COMPACT_SELECT = 'h-6 border-transparent bg-transparent pl-1.5 pr-1 text-caption hover:bg-line-8 data-[state=open]:border-transparent data-[state=open]:bg-line-8'

export function ModelSettingsPopover({ provider, model, onPatch, onRemove, disabled = false }: ModelSettingsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const capabilities = modelCapabilities(provider, model)
  const effortOptions = EFFORT_OPTIONS.filter(o => o.value === EFFORT_DEFAULT || capabilities.reasoning.includes(o.value))
  const limit = capabilities.contextLimit
  const windows = [...new Set([...CONTEXT_WINDOWS, model.contextWindow, ...(limit ? [limit] : [])])].filter(n => !limit || n <= limit).sort((a, b) => a - b)
  const contextOptions = windows.map(n => ({ value: String(n), label: formatContext(n) }))
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton size="sm" icon={Pencil} label={`设置 ${model.label}`} disabled={disabled} active={open} className="text-fg-3" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[240px] p-1.5">
          {capabilities.reasoning.length > 0 ? <div className={cn(ROW, 'bg-line-6')}>
            <span className={LABEL}>推理强度</span>
            <Select<EffortValue>
              aria-label="推理强度"
              options={effortOptions}
              value={model.reasoningEffort && capabilities.reasoning.includes(model.reasoningEffort) ? model.reasoningEffort : EFFORT_DEFAULT}
              onValueChange={(v) => onPatch({ reasoningEffort: v === EFFORT_DEFAULT ? undefined : v })}
              align="end"
              className={COMPACT_SELECT}
              contentClassName="w-[200px]"
            />
          </div> : null}
          {capabilities.thinking === 'budget' ? <div className={ROW}>
            <span className={LABEL}>思考预算</span>
            <NumberSetting key={`${model.modelId}-thinking`} label="思考预算" min={capabilities.thinkingBudgetMin ?? 0} max={capabilities.thinkingBudgetMax} value={model.thinkingBudget} onChange={v => onPatch({ thinkingBudget: v })} />
          </div> : null}
          {capabilities.fast ? <div className={ROW}>
            <span className={LABEL}>快速（额外费用）</span>
            <Toggle label="快速模式" checked={model.fast === true} onCheckedChange={(v) => onPatch({ fast: v || undefined })} />
          </div> : null}
          {capabilities.temperature && !(provider.kind === 'anthropic' && capabilities.thinking === 'budget' && (model.thinkingBudget ?? 0) > 0) ? <div className={ROW}>
            <span className={LABEL}>温度</span>
            <Select options={[{ value: 'default', label: '默认' }, ...[0, 0.2, 0.5, 0.7, 1].map(n => ({ value: String(n), label: String(n) }))]} value={String(model.temperature ?? 'default')} onValueChange={v => onPatch({ temperature: v === 'default' ? undefined : Number(v) })} aria-label="温度" className={COMPACT_SELECT} />
          </div> : null}
          <div className={ROW}>
            <span className={LABEL}>上下文预算</span>
            <Select<string> aria-label="上下文用量" options={contextOptions} value={String(model.contextWindow)} onValueChange={(v) => onPatch({ contextWindow: Number(v) })} align="end" className={COMPACT_SELECT} contentClassName="w-[140px]" />
          </div>
          <div className={ROW}>
            <span className={LABEL}>最大输出</span>
            <NumberSetting key={`${model.modelId}-output`} label="最大输出" min={1} max={capabilities.outputLimit} value={model.maxOutputTokens} onChange={v => onPatch({ maxOutputTokens: v })} />
          </div>
          <p className="px-2 py-1 text-note text-fg-3">{capabilities.source === 'unknown' ? '未确认模型能力，使用服务商默认参数。上下文为本地预算，不代表模型上限。' : `仅显示此模型支持的选项。${limit ? `上下文上限 ${formatContext(limit)}。` : '上下文为本地预算。'}`}</p>
          <Divider strength={8} className="my-1" />
          <Button
            variant="link"
            size="sm"
            icon={Trash}
            className="w-full justify-start text-danger hover:bg-danger/8 active:bg-danger/14"
            onClick={() => {
              setOpen(false)
              setConfirmRemove(true)
            }}
          >
            移除此模型
          </Button>
        </PopoverContent>
      </Popover>
      <DangerDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`移除「${model.label}」？`}
        description="该模型将从列表中移除；引用它的会话会回退到默认模型。随时可以重新添加。"
        confirmLabel="移除"
        onConfirm={() => {
          setConfirmRemove(false)
          onRemove()
        }}
      />
    </>
  )
}

function NumberSetting({ label, min, max, value, onChange }: { label: string; min: number; max?: number; value?: number; onChange: (value: number | undefined) => void }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const valid = draft === '' || (Number.isInteger(Number(draft)) && Number(draft) >= min && Number(draft) <= (max ?? Infinity))
  return <Input size="sm" type="number" aria-label={label} placeholder="默认" min={min} max={max} value={draft} wrapperClassName="w-24" error={valid ? undefined : `${min}–${max ?? '∞'}`} onChange={e => setDraft(e.target.value)} onBlur={() => {
    if (valid) onChange(draft === '' ? undefined : Number(draft))
    else setDraft(String(value ?? ''))
  }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}
