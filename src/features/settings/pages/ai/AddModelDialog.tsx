/**
 * 添加模型 — type a model id or pick one from the endpoint's list (ai:listRemoteModels). Small FormDialog.
 */
import { ListFilter } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  EmptyState,
  FormDialog,
  IconButton,
  Input,
  MenuItemContent,
  cn,
  menuItemClass,
  menuLabelClass,
  toast,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import { filterSuggestions } from '../../aiModel'
import { errorMessage } from '../../hooks'

export interface AddModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: ProviderConfig
  onAdd: (modelId: string) => Promise<void> | void
}

export function AddModelDialog({ open, onOpenChange, provider, onAdd }: AddModelDialogProps) {
  const t = useT()
  const [modelId, setModelId] = useState('')
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setModelId('')
    setSuggestions(null)
  }, [open])

  const exists = provider.models.some((m) => m.modelId === modelId.trim())
  const error = !modelId.trim()
    ? t('settings.ai.shared.modelIdRequired')
    : exists
      ? t('settings.ai.addModel.exists')
      : undefined
  const visible = useMemo(
    () =>
      suggestions
        ? filterSuggestions(
            suggestions.filter((s) => !provider.models.some((m) => m.modelId === s)),
            modelId,
            8,
          )
        : [],
    [suggestions, modelId, provider.models],
  )

  const fetchModels = async () => {
    setFetching(true)
    try {
      setSuggestions((await invoke('ai:discoverModels', { provider })).map((m) => m.modelId))
    } catch (e) {
      setSuggestions([])
      toast.error(t('settings.ai.shared.fetchModelsFailed'), { detail: errorMessage(e) })
    } finally {
      setFetching(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={t('settings.ai.addModel.title', { label: provider.label })}
      description={t('settings.ai.addModel.description')}
      submitLabel={t('common.add')}
      submitDisabled={Boolean(error)}
      submitDisabledReason={error}
      loading={saving}
      onSubmit={async () => {
        setSaving(true)
        try {
          await onAdd(modelId.trim())
          onOpenChange(false)
        } finally {
          setSaving(false)
        }
      }}
    >
      <Input
        mono
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        placeholder={t('settings.ai.shared.modelIdPlaceholder')}
        aria-label={t('settings.ai.shared.modelId')}
        autoFocus
        error={modelId.trim() && exists ? error : undefined}
        trailing={
          <IconButton
            size="xs"
            icon={ListFilter}
            label={t('settings.ai.shared.fetchModels')}
            loading={fetching}
            onClick={() => void fetchModels()}
            className="text-fg-3"
          />
        }
      />
      {suggestions !== null || fetching ? (
        <div className="rounded-item border border-line-6 bg-content p-1.5">
          {fetching ? (
            <EmptyState variant="loading" compact title={t('settings.ai.shared.loadingModels')} />
          ) : suggestions && suggestions.length === 0 ? (
            <EmptyState
              variant="empty"
              compact
              title={t('settings.ai.shared.noModelsReturned')}
              description={t('settings.ai.addModel.noModelsHint')}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              variant="no-results"
              compact
              title={t('settings.ai.shared.noMatchingModel', { query: modelId })}
              description={t('settings.ai.shared.modelsReturnedTotal', { n: suggestions?.length ?? 0 })}
            />
          ) : (
            <>
              <div className={menuLabelClass}>
                {t('settings.ai.addModel.suggestionsSummary', { n: suggestions?.length ?? 0 })}
              </div>
              <div
                role="listbox"
                aria-label={t('settings.ai.shared.modelList')}
                className="flex max-h-[200px] flex-col gap-px overflow-y-auto"
              >
                {visible.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={m === modelId.trim()}
                    onClick={() => setModelId(m)}
                    className={cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')}
                  >
                    <MenuItemContent label={<span className="font-mono">{m}</span>} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </FormDialog>
  )
}
