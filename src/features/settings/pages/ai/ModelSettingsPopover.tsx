/**
 * Per-model settings popover behind the ✎ on a model row (Figma 164:3520): 推理强度 / 快速 / 上下文用量,
 * plus 移除此模型 at the bottom. Every change writes through immediately (DESIGN-SPEC §2 生效时机).
 */
import { Pencil, Trash } from 'lucide-react'
import { useState } from 'react'
import { modelCapabilities, type ProviderConfig, type ModelEntry, type ReasoningEffort } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import {
  Button,
  DangerDialog,
  Divider,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Input,
  Toggle,
  cn,
  type SelectOption,
} from '@/kit'
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

const EFFORT_OPTIONS: ReadonlyArray<{ value: EffortValue; label: MessageKey; description: MessageKey }> = [
  {
    value: EFFORT_DEFAULT,
    label: 'settings.ai.modelSettings.default',
    description: 'settings.ai.modelSettings.effortDefaultDescription',
  },
  ...REASONING_EFFORTS.map((e) => ({ value: e.value, label: e.label, description: e.description })),
]

const ROW = 'flex h-8 items-center gap-2 rounded-control px-2'
const LABEL = 'min-w-0 flex-1 text-caption text-fg-3'
const COMPACT_SELECT =
  'h-6 border-transparent bg-transparent pl-1.5 pr-1 text-caption hover:bg-line-8 data-[state=open]:border-transparent data-[state=open]:bg-line-8'

export function ModelSettingsPopover({
  provider,
  model,
  onPatch,
  onRemove,
  disabled = false,
}: ModelSettingsPopoverProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const capabilities = modelCapabilities(provider, model)
  const effortOptions: SelectOption<EffortValue>[] = EFFORT_OPTIONS.filter(
    (o) => o.value === EFFORT_DEFAULT || capabilities.reasoning.includes(o.value),
  ).map((o) => ({ value: o.value, label: t(o.label), description: t(o.description) }))
  const limit = capabilities.contextLimit
  const windows = [...new Set([...CONTEXT_WINDOWS, model.contextWindow, ...(limit ? [limit] : [])])]
    .filter((n) => !limit || n <= limit)
    .sort((a, b) => a - b)
  const contextOptions = windows.map((n) => ({ value: String(n), label: formatContext(n) }))
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton
            size="sm"
            icon={Pencil}
            label={t('settings.ai.modelSettings.trigger', { name: model.label })}
            disabled={disabled}
            active={open}
            className="text-fg-3"
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[240px] p-1.5">
          {capabilities.reasoning.length > 0 ? (
            <div className={cn(ROW, 'bg-line-6')}>
              <span className={LABEL}>{t('settings.ai.modelSettings.effort')}</span>
              <Select<EffortValue>
                aria-label={t('settings.ai.modelSettings.effort')}
                options={effortOptions}
                value={
                  model.reasoningEffort && capabilities.reasoning.includes(model.reasoningEffort)
                    ? model.reasoningEffort
                    : EFFORT_DEFAULT
                }
                onValueChange={(v) => onPatch({ reasoningEffort: v === EFFORT_DEFAULT ? undefined : v })}
                align="end"
                className={COMPACT_SELECT}
                contentClassName="w-[200px]"
              />
            </div>
          ) : null}
          {capabilities.thinking === 'budget' ? (
            <div className={ROW}>
              <span className={LABEL}>{t('settings.ai.modelSettings.thinkingBudget')}</span>
              <NumberSetting
                key={`${model.modelId}-thinking`}
                label={t('settings.ai.modelSettings.thinkingBudget')}
                min={capabilities.thinkingBudgetMin ?? 0}
                max={capabilities.thinkingBudgetMax}
                value={model.thinkingBudget}
                onChange={(v) => onPatch({ thinkingBudget: v })}
              />
            </div>
          ) : null}
          {capabilities.fast ? (
            <div className={ROW}>
              <span className={LABEL}>{t('settings.ai.modelSettings.fast')}</span>
              <Toggle
                label={t('settings.ai.modelSettings.fastMode')}
                checked={model.fast === true}
                onCheckedChange={(v) => onPatch({ fast: v || undefined })}
              />
            </div>
          ) : null}
          {capabilities.temperature &&
          !(provider.kind === 'anthropic' && capabilities.thinking === 'budget' && (model.thinkingBudget ?? 0) > 0) ? (
            <div className={ROW}>
              <span className={LABEL}>{t('settings.ai.modelSettings.temperature')}</span>
              <Select
                options={[
                  { value: 'default', label: t('settings.ai.modelSettings.default') },
                  ...[0, 0.2, 0.5, 0.7, 1].map((n) => ({ value: String(n), label: String(n) })),
                ]}
                value={String(model.temperature ?? 'default')}
                onValueChange={(v) => onPatch({ temperature: v === 'default' ? undefined : Number(v) })}
                aria-label={t('settings.ai.modelSettings.temperature')}
                className={COMPACT_SELECT}
              />
            </div>
          ) : null}
          <div className={ROW}>
            <span className={LABEL}>{t('settings.ai.modelSettings.contextBudget')}</span>
            <Select<string>
              aria-label={t('settings.ai.modelSettings.contextUsage')}
              options={contextOptions}
              value={String(model.contextWindow)}
              onValueChange={(v) => onPatch({ contextWindow: Number(v) })}
              align="end"
              className={COMPACT_SELECT}
              contentClassName="w-[140px]"
            />
          </div>
          <div className={ROW}>
            <span className={LABEL}>{t('settings.ai.modelSettings.maxOutput')}</span>
            <NumberSetting
              key={`${model.modelId}-output`}
              label={t('settings.ai.modelSettings.maxOutput')}
              min={1}
              max={capabilities.outputLimit}
              value={model.maxOutputTokens}
              onChange={(v) => onPatch({ maxOutputTokens: v })}
            />
          </div>
          <p className="px-2 py-1 text-note text-fg-3">
            {capabilities.source === 'unknown'
              ? t('settings.ai.modelSettings.unknownCapabilities')
              : limit
                ? t('settings.ai.modelSettings.noteWithLimit', { limit: formatContext(limit) })
                : t('settings.ai.modelSettings.noteLocalBudget')}
          </p>
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
            {t('settings.ai.modelSettings.remove')}
          </Button>
        </PopoverContent>
      </Popover>
      <DangerDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('settings.ai.modelSettings.removeTitle', { name: model.label })}
        description={t('settings.ai.modelSettings.removeDescription')}
        confirmLabel={t('common.remove')}
        onConfirm={() => {
          setConfirmRemove(false)
          onRemove()
        }}
      />
    </>
  )
}

function NumberSetting({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  min: number
  max?: number
  value?: number
  onChange: (value: number | undefined) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(String(value ?? ''))
  const valid =
    draft === '' || (Number.isInteger(Number(draft)) && Number(draft) >= min && Number(draft) <= (max ?? Infinity))
  return (
    <Input
      size="sm"
      type="number"
      aria-label={label}
      placeholder={t('settings.ai.modelSettings.default')}
      min={min}
      max={max}
      value={draft}
      wrapperClassName="w-24"
      error={valid ? undefined : `${min}–${max ?? '∞'}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (valid) onChange(draft === '' ? undefined : Number(draft))
        else setDraft(String(value ?? ''))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
