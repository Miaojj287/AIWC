/**
 * 添加模型 — type a model id or pick one from the endpoint's list (ai:listRemoteModels). Small FormDialog.
 */
import { ListFilter } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { EmptyState, FormDialog, IconButton, Input, cn, toast } from '@/kit'
import { MenuItemContent } from '@/kit/menu/MenuItemBody'
import { menuItemClass, menuLabelClass } from '@/kit/menu/menuStyles'
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
  const error = !modelId.trim() ? '请填写模型 ID' : exists ? '该模型已在列表中' : undefined
  const visible = useMemo(() => (suggestions ? filterSuggestions(suggestions.filter((s) => !provider.models.some((m) => m.modelId === s)), modelId, 8) : []), [suggestions, modelId, provider.models])

  const fetchModels = async () => {
    setFetching(true)
    try {
      setSuggestions((await invoke('ai:discoverModels', { provider })).map(m => m.modelId))
    } catch (e) {
      setSuggestions([])
      toast.error('拉取模型列表失败', { detail: errorMessage(e) })
    } finally {
      setFetching(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={`向「${provider.label}」添加模型`}
      description="填写模型 ID，或从接口拉取可用列表后选择"
      submitLabel="添加"
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
        placeholder="例如 gpt-4.1 / qwen3:8b"
        aria-label="模型 ID"
        autoFocus
        error={modelId.trim() && exists ? error : undefined}
        trailing={<IconButton size="xs" icon={ListFilter} label="从接口拉取模型列表" loading={fetching} onClick={() => void fetchModels()} className="text-fg-3" />}
      />
      {suggestions !== null || fetching ? (
        <div className="rounded-item border border-line-6 bg-content p-1.5">
          {fetching ? (
            <EmptyState variant="loading" compact title="读取模型列表" />
          ) : suggestions && suggestions.length === 0 ? (
            <EmptyState variant="empty" compact title="接口未返回模型" description="检查接口地址与 Key 后重试，或直接手动填写" />
          ) : visible.length === 0 ? (
            <EmptyState variant="no-results" compact title={`没有匹配「${modelId}」的模型`} description={`接口共返回 ${suggestions?.length ?? 0} 个模型`} />
          ) : (
            <>
              <div className={menuLabelClass}>接口返回 {suggestions?.length ?? 0} 个模型</div>
              <div role="listbox" aria-label="模型列表" className="flex max-h-[200px] flex-col gap-px overflow-y-auto">
                {visible.map((m) => (
                  <button key={m} type="button" role="option" aria-selected={m === modelId.trim()} onClick={() => setModelId(m)} className={cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')}>
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
