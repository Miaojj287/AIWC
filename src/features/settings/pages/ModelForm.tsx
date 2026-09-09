/**
 * <ModelForm/> — the ONE model-access form (DESIGN-SPEC §2 AI 接入): 提供商兼容方式 / URL / Key / 模型 ID /
 * 连接状态 + 测试连接 + 保存. Used for the Agent model and, unchanged, for online speech-to-text.
 * Figma 142:415, board 151:415 ④.
 */
import { Link, ListFilter, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { Badge, Button, EmptyState, IconButton, InlineHint, Input, Popover, PopoverAnchor, PopoverContent, Select, cn, toast, type SelectOption } from '@/kit'
// TODO(kit): the barrel does not export the menu item primitives yet; deep-import so the suggestion list
// reuses the ONE kit menu item (geometry, hover, label layout) instead of re-implementing it (CLAUDE.md §3).
import { MenuItemContent } from '@/kit/menu/MenuItemBody'
import { menuItemClass, menuLabelClass } from '@/kit/menu/menuStyles'
import { invoke } from '@/platform/hooks'
import { PROVIDER_KINDS, apiKeyRefFor, applyDraft, draftDirty, draftFromProvider, filterSuggestions, isDraftValid, isLocalKind, kindMeta, testStateFromResult, testStatusLine, validateModelDraft, type ModelDraft, type TestState } from '../aiModel'
import { errorMessage, useSecretPresence } from '../hooks'
import { SRow } from '../pageKit'

export interface ModelFormProps {
  provider: ProviderConfig
  /** Persist the provider after validation (config write). */
  onSave: (next: ProviderConfig) => Promise<void>
  purpose: 'agent' | 'stt'
  /** Search-index row ids for highlight (page-specific). */
  rowIds: { kind: string; baseUrl: string; apiKey: string; modelId: string; status: string }
  /**
   * Emphasis of the 保存 button. Default 'primary'; pass 'outline' when another form on the same page
   * already holds the screen's single primary (CLAUDE.md §2.2 / §3 「每屏最多一个 primary」).
   */
  primaryTone?: 'primary' | 'outline'
}

const KIND_OPTIONS: SelectOption<ProviderConfig['kind']>[] = PROVIDER_KINDS.map((k) => ({
  value: k.value,
  label: k.label,
  description: k.description,
  badge: k.local ? <Badge tone="ok">本地</Badge> : undefined,
}))

export function ModelForm({ provider, onSave, purpose, rowIds, primaryTone = 'primary' }: ModelFormProps) {
  const [draft, setDraft] = useState<ModelDraft>(() => draftFromProvider(provider))
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const keyRef = provider.apiKeyRef ?? apiKeyRefFor(provider.id)
  const secret = useSecretPresence(keyRef)

  // Reset when another provider is selected.
  useEffect(() => {
    setDraft(draftFromProvider(provider))
    setTest({ status: 'idle' })
    setSuggestions(null)
  }, [provider.id])

  const hasKey = Boolean(secret.has)
  const errors = validateModelDraft(draft, hasKey)
  const valid = isDraftValid(errors)
  const dirty = draftDirty(provider, draft)
  const local = isLocalKind(draft.kind)
  const status = testStatusLine(test, purpose)
  const patch = (p: Partial<ModelDraft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setTest({ status: 'idle' })
  }

  const setKind = (kind: ProviderConfig['kind']) => {
    const meta = kindMeta(kind)
    const prevDefault = kindMeta(draft.kind).defaultBaseUrl
    // keep a customised URL; swap only when it was still the previous kind's default (or empty)
    const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === prevDefault ? meta.defaultBaseUrl : draft.baseUrl
    patch({ kind, baseUrl })
  }

  const candidate = (): ProviderConfig => applyDraft(provider, draft, { apiKeyRef: keyRef })

  const runTest = async () => {
    setTest({ status: 'testing' })
    try {
      const res = await invoke('ai:testModel', { provider: candidate(), modelId: draft.modelId.trim(), apiKey: draft.apiKey.trim() || undefined })
      setTest(testStateFromResult(res))
    } catch (e) {
      setTest({ status: 'error', message: errorMessage(e) })
    }
  }

  const fetchModels = async () => {
    setFetching(true)
    setSuggestOpen(true)
    try {
      const list = await invoke('ai:listRemoteModels', { provider: candidate(), apiKey: draft.apiKey.trim() || undefined })
      setSuggestions(list)
    } catch (e) {
      setSuggestions([])
      toast.error('拉取模型列表失败', { detail: errorMessage(e) })
    } finally {
      setFetching(false)
    }
  }

  const save = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const typedKey = draft.apiKey.trim()
      if (typedKey) await invoke('secret:set', { ref: keyRef, value: typedKey })
      const supportsTools = test.status === 'ok' ? test.supportsTools : undefined
      await onSave(applyDraft(provider, draft, { apiKeyRef: typedKey || provider.apiKeyRef ? keyRef : undefined, supportsTools }))
      setDraft((d) => ({ ...d, apiKey: '' }))
      if (typedKey) secret.reload()
      toast.success(purpose === 'agent' ? '模型配置已保存' : '转写接口已保存')
    } catch (e) {
      toast.error('保存失败', { detail: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const visibleSuggestions = useMemo(() => (suggestions ? filterSuggestions(suggestions, draft.modelId) : []), [suggestions, draft.modelId])
  const saveReason = !valid ? Object.values(errors)[0] : !dirty ? '没有需要保存的修改' : undefined

  return (
    <>
      <SRow id={rowIds.kind} title="提供商兼容方式" description="决定请求格式与鉴权头" htmlFor={`${provider.id}-kind`}>
        <Select id={`${provider.id}-kind`} aria-label="提供商兼容方式" options={KIND_OPTIONS} value={draft.kind} onValueChange={setKind} align="end" className="min-w-[160px]" />
      </SRow>
      <SRow id={rowIds.baseUrl} title="接口 URL" description="Base URL，不含路径后缀" htmlFor={`${provider.id}-url`}>
        <Input id={`${provider.id}-url`} mono size="sm" value={draft.baseUrl} placeholder={kindMeta(draft.kind).defaultBaseUrl || 'https://…'} onChange={(e) => patch({ baseUrl: e.target.value })} error={draft.baseUrl && errors.baseUrl ? errors.baseUrl : undefined} wrapperClassName="w-[260px]" />
      </SRow>
      <SRow id={rowIds.apiKey} title="API Key" description={local ? '本地模型无需 Key，数据不出本机' : hasKey ? '已保存在本机钥匙串，输入新值即可替换' : '仅保存在本机钥匙串，不会上传'} htmlFor={`${provider.id}-key`} disabled={local}>
        <Input id={`${provider.id}-key`} type="password" mono size="sm" value={draft.apiKey} placeholder={hasKey ? '•••••••• 已保存' : 'sk-…'} onChange={(e) => patch({ apiKey: e.target.value })} autoComplete="off" wrapperClassName="w-[260px]" />
      </SRow>
      <SRow id={rowIds.modelId} title="模型 ID" description={purpose === 'agent' ? '默认模型，可在对话框底部临时切换' : '用于 audio/transcriptions 的转写模型'} htmlFor={`${provider.id}-model`}>
        <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
          <PopoverAnchor asChild>
            <div className="w-[260px]">
              <Input
                id={`${provider.id}-model`}
                mono
                size="sm"
                value={draft.modelId}
                placeholder={purpose === 'agent' ? '例如 gpt-4.1 / qwen3:8b' : '例如 whisper-1'}
                onChange={(e) => {
                  patch({ modelId: e.target.value })
                  if (suggestions) setSuggestOpen(true)
                }}
                onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
                error={errors.modelId && draft.modelId === '' && dirty ? errors.modelId : undefined}
                trailing={<IconButton size="xs" icon={ListFilter} label="从接口拉取模型列表" loading={fetching} onClick={() => void fetchModels()} className="text-fg-3" />}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()} className="w-[260px] p-1.5">
            {fetching ? (
              <EmptyState variant="loading" compact title="读取模型列表" />
            ) : !suggestions || suggestions.length === 0 ? (
              <EmptyState variant="empty" compact title="接口未返回模型" description="检查接口 URL 与 Key 后重试，或直接手动填写模型 ID" />
            ) : visibleSuggestions.length === 0 ? (
              <EmptyState variant="no-results" compact title={`没有匹配「${draft.modelId}」的模型`} description={`接口共返回 ${suggestions.length} 个模型`} />
            ) : (
              <>
                <div className={menuLabelClass}>
                  接口返回 {suggestions.length} 个模型 · 匹配 {visibleSuggestions.length} 个
                </div>
                <div role="listbox" aria-label="模型列表" className="flex max-h-[220px] flex-col gap-px overflow-y-auto">
                  {visibleSuggestions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={m === draft.modelId.trim()}
                      onClick={() => {
                        patch({ modelId: m })
                        setSuggestOpen(false)
                      }}
                      className={cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')}
                    >
                      <MenuItemContent label={<span className="font-mono">{m}</span>} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      </SRow>
      <SRow id={rowIds.status} title="连接状态" description={<InlineHint kind={status.kind}>{status.text}</InlineHint>}>
        <Button variant="ghost" icon={Link} onClick={() => void runTest()} loading={test.status === 'testing'} disabled={!draft.modelId.trim()}>
          测试连接
        </Button>
        <Button variant={primaryTone} icon={Save} onClick={() => void save()} loading={saving} disabled={!valid || !dirty} title={saveReason}>
          保存
        </Button>
      </SRow>
    </>
  )
}
