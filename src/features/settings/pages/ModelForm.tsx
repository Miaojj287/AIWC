/**
 * <ModelForm/> — the ONE model-access form (DESIGN-SPEC §2 AI 接入): 提供商兼容方式 / URL / Key / 模型 ID /
 * 连接状态 + 测试连接 + 保存. Used for the Agent model and, unchanged, for online speech-to-text.
 * Figma 142:415, board 151:415 ④.
 */
import { Link, ListFilter, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { useT, type Translator } from '@/i18n'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  InlineHint,
  Input,
  MenuItemContent,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Select,
  cn,
  menuItemClass,
  menuLabelClass,
  toast,
  type SelectOption,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import {
  PROVIDER_KINDS,
  apiKeyRefFor,
  applyDraft,
  draftDirty,
  draftFromProvider,
  filterSuggestions,
  isDraftValid,
  isLocalKind,
  kindMeta,
  testStateFromResult,
  testStatusLine,
  validateModelDraft,
  type ModelDraft,
  type TestState,
} from '../aiModel'
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

/** Built per render: kind labels are catalog getters, so the options follow the current language. */
const kindOptions = (t: Translator): SelectOption<ProviderConfig['kind']>[] =>
  PROVIDER_KINDS.map((k) => ({
    value: k.value,
    label: k.label,
    description: k.description,
    badge: k.local ? <Badge tone="ok">{t('settings.ai.shared.local')}</Badge> : undefined,
  }))

export function ModelForm({ provider, onSave, purpose, rowIds, primaryTone = 'primary' }: ModelFormProps) {
  const t = useT()
  const [draft, setDraft] = useState<ModelDraft>(() => draftFromProvider(provider))
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const keyRef = provider.apiKeyRef ?? apiKeyRefFor(provider.id)
  const secret = useSecretPresence(keyRef)

  // Reset when another provider is selected — keyed on the id on purpose: a config refresh of the same
  // provider must not wipe the user's unsaved draft. (Cleaner: the parent passes key={provider.id}.)
  useEffect(() => {
    setDraft(draftFromProvider(provider))
    setTest({ status: 'idle' })
    setSuggestions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const res = await invoke('ai:testModel', {
        provider: candidate(),
        modelId: draft.modelId.trim(),
        apiKey: draft.apiKey.trim() || undefined,
      })
      setTest(testStateFromResult(res))
    } catch (e) {
      setTest({ status: 'error', message: errorMessage(e) })
    }
  }

  const fetchModels = async () => {
    setFetching(true)
    setSuggestOpen(true)
    try {
      const list = await invoke('ai:listRemoteModels', {
        provider: candidate(),
        apiKey: draft.apiKey.trim() || undefined,
      })
      setSuggestions(list)
    } catch (e) {
      setSuggestions([])
      toast.error(t('settings.ai.shared.fetchModelsFailed'), { detail: errorMessage(e) })
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
      await onSave(
        applyDraft(provider, draft, { apiKeyRef: typedKey || provider.apiKeyRef ? keyRef : undefined, supportsTools }),
      )
      setDraft((d) => ({ ...d, apiKey: '' }))
      if (typedKey) secret.reload()
      toast.success(purpose === 'agent' ? t('settings.ai.modelForm.savedAgent') : t('settings.ai.modelForm.savedStt'))
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const visibleSuggestions = useMemo(
    () => (suggestions ? filterSuggestions(suggestions, draft.modelId) : []),
    [suggestions, draft.modelId],
  )
  const saveReason = !valid ? Object.values(errors)[0] : !dirty ? t('settings.ai.modelForm.noChanges') : undefined

  return (
    <>
      <SRow
        id={rowIds.kind}
        title={t('settings.ai.modelForm.kind')}
        description={t('settings.ai.shared.kindHint')}
        htmlFor={`${provider.id}-kind`}
      >
        <Select
          id={`${provider.id}-kind`}
          aria-label={t('settings.ai.modelForm.kind')}
          options={kindOptions(t)}
          value={draft.kind}
          onValueChange={setKind}
          align="end"
          className="min-w-[160px]"
        />
      </SRow>
      <SRow
        id={rowIds.baseUrl}
        title={t('settings.ai.modelForm.baseUrl')}
        description={t('settings.ai.shared.baseUrlHint')}
        htmlFor={`${provider.id}-url`}
      >
        <Input
          id={`${provider.id}-url`}
          mono
          size="sm"
          value={draft.baseUrl}
          placeholder={kindMeta(draft.kind).defaultBaseUrl || 'https://…'}
          onChange={(e) => patch({ baseUrl: e.target.value })}
          error={draft.baseUrl && errors.baseUrl ? errors.baseUrl : undefined}
          wrapperClassName="w-[260px]"
        />
      </SRow>
      <SRow
        id={rowIds.apiKey}
        title="API Key"
        description={
          local
            ? t('settings.ai.shared.localNoKey')
            : hasKey
              ? t('settings.ai.modelForm.keyStored')
              : t('settings.ai.shared.keyLocalOnly')
        }
        htmlFor={`${provider.id}-key`}
        disabled={local}
      >
        <Input
          id={`${provider.id}-key`}
          type="password"
          mono
          size="sm"
          value={draft.apiKey}
          placeholder={hasKey ? t('settings.ai.shared.keySaved') : 'sk-…'}
          onChange={(e) => patch({ apiKey: e.target.value })}
          autoComplete="off"
          wrapperClassName="w-[260px]"
        />
      </SRow>
      <SRow
        id={rowIds.modelId}
        title={t('settings.ai.shared.modelId')}
        description={
          purpose === 'agent' ? t('settings.ai.modelForm.modelIdAgent') : t('settings.ai.modelForm.modelIdStt')
        }
        htmlFor={`${provider.id}-model`}
      >
        <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
          <PopoverAnchor asChild>
            <div className="w-[260px]">
              <Input
                id={`${provider.id}-model`}
                mono
                size="sm"
                value={draft.modelId}
                placeholder={
                  purpose === 'agent'
                    ? t('settings.ai.shared.modelIdPlaceholder')
                    : t('settings.ai.modelForm.sttModelPlaceholder')
                }
                onChange={(e) => {
                  patch({ modelId: e.target.value })
                  if (suggestions) setSuggestOpen(true)
                }}
                onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
                error={errors.modelId && draft.modelId === '' && dirty ? errors.modelId : undefined}
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
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()} className="w-[260px] p-1.5">
            {fetching ? (
              <EmptyState variant="loading" compact title={t('settings.ai.shared.loadingModels')} />
            ) : !suggestions || suggestions.length === 0 ? (
              <EmptyState
                variant="empty"
                compact
                title={t('settings.ai.shared.noModelsReturned')}
                description={t('settings.ai.modelForm.noModelsHint')}
              />
            ) : visibleSuggestions.length === 0 ? (
              <EmptyState
                variant="no-results"
                compact
                title={t('settings.ai.shared.noMatchingModel', { query: draft.modelId })}
                description={t('settings.ai.shared.modelsReturnedTotal', { n: suggestions.length })}
              />
            ) : (
              <>
                <div className={menuLabelClass}>
                  {t('settings.ai.modelForm.suggestionsSummary', {
                    total: suggestions.length,
                    matched: visibleSuggestions.length,
                  })}
                </div>
                <div
                  role="listbox"
                  aria-label={t('settings.ai.shared.modelList')}
                  className="flex max-h-[220px] flex-col gap-px overflow-y-auto"
                >
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
      <SRow
        id={rowIds.status}
        title={t('settings.ai.modelForm.status')}
        description={<InlineHint kind={status.kind}>{status.text}</InlineHint>}
      >
        <Button
          variant="ghost"
          icon={Link}
          onClick={() => void runTest()}
          loading={test.status === 'testing'}
          disabled={!draft.modelId.trim()}
        >
          {t('settings.ai.shared.testConnection')}
        </Button>
        <Button
          variant={primaryTone}
          icon={Save}
          onClick={() => void save()}
          loading={saving}
          disabled={!valid || !dirty}
          title={saveReason}
        >
          {t('common.save')}
        </Button>
      </SRow>
    </>
  )
}
