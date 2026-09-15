/**
 * 接入模型 dialog (Figma 164:4892 vendor / 164:5500 custom): provider row, 接口地址, API Key (+ 前往官网获取),
 * 可用模型 chips (preset + pulled from the endpoint + typed), 连接测试 on the footer's left, 取消 / 确认.
 * Also used to re-enter a key (`mode: 'key'`) and to edit a custom endpoint (`mode: 'custom'`).
 */
import { ExternalLink, KeyRound, ListFilter, Plug, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import type { ModelEntry, ProviderConfig, ProviderKind } from '@aiwc/protocol'
import { useT, type Translator } from '@/i18n'
import {
  Badge,
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  ICON_STROKE,
  IconButton,
  InlineHint,
  Input,
  Select,
  buttonVariants,
  cn,
  toast,
  type SelectOption,
  vendorIconFor,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import {
  PROVIDER_KINDS,
  apiKeyRefFor,
  isLocalKind,
  kindMeta,
  syncProviderModels,
  mergeModels,
  modelEntryFromId,
  testStateFromResult,
  testStatusLine,
  type TestState,
} from '../../aiModel'
import { errorMessage, useSecretPresence } from '../../hooks'
import { type VendorPreset } from '../../vendors'

export type ConnectMode = 'connect' | 'key' | 'custom'

export interface ConnectProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ConnectMode
  /** Vendor preset (connect / key on a preset provider). */
  vendor?: VendorPreset
  /** Existing provider (key / custom edit, or re-connecting a preset that already has settings). */
  provider?: ProviderConfig
  /** Persist the provider (config write + secret already stored by the dialog). */
  onSave: (next: ProviderConfig) => Promise<void>
}

/** Built per render: kind labels are catalog getters, so the options follow the current language. */
const kindOptions = (t: Translator): SelectOption<ProviderKind>[] =>
  PROVIDER_KINDS.map((k) => ({
    value: k.value,
    label: k.label,
    description: k.description,
    badge: k.local ? <Badge tone="ok">{t('settings.ai.shared.local')}</Badge> : undefined,
  }))
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

let customSeq = 0
const newCustomId = () => `custom-${Date.now().toString(36)}${(customSeq++).toString(36)}`

export function ConnectProviderDialog({
  open,
  onOpenChange,
  mode,
  vendor,
  provider,
  onSave,
}: ConnectProviderDialogProps) {
  const t = useT()
  const epoch = useRef(0)
  const testedModel = useRef<string | undefined>(undefined)
  const seeded = useRef<string | null>(null)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ProviderKind>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [candidates, setCandidates] = useState<ModelEntry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [fetching, setFetching] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [labelTouched, setLabelTouched] = useState(false)
  const [customId] = useState(newCustomId)

  const id = provider?.id ?? vendor?.id ?? customId
  const keyRef = provider?.apiKeyRef ?? apiKeyRefFor(id)
  const secret = useSecretPresence(keyRef, open ? 1 : 0)
  const hasStoredKey = Boolean(provider?.apiKeyRef) && secret.has !== false

  // (Re)seed the form whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      seeded.current = null
      return
    }
    if (seeded.current === id) return
    seeded.current = id
    setLabel(provider?.label ?? vendor?.label ?? '')
    setKind(provider?.kind ?? vendor?.kind ?? 'openai-compatible')
    setBaseUrl(provider?.baseUrl ?? vendor?.baseUrl ?? '')
    setApiKey('')
    const presets: ModelEntry[] = []
    const existing = provider?.models ?? []
    const merged = [...existing, ...presets.filter((m) => !existing.some((e) => e.modelId === m.modelId))]
    setCandidates(merged)
    setSelected((existing.length > 0 ? existing : presets).map((m) => m.modelId))
    setTyped('')
    setLabelTouched(false)
    setTest({ status: 'idle' })
  }, [open, provider, vendor, id])

  useEffect(() => {
    epoch.current += 1
    setFetching(false)
    setTest({ status: 'idle' })
  }, [open, kind, baseUrl, apiKey])

  const local = isLocalKind(kind)
  const editingOnlyKey = mode === 'key'
  const urlRequired = kind === 'openai-compatible' || kind === 'ollama'
  const url = baseUrl.trim()
  const urlError = url
    ? URL_RE.test(url)
      ? undefined
      : t('settings.ai.shared.urlScheme')
    : urlRequired
      ? t('settings.ai.connectDialog.urlRequired')
      : undefined
  const keyError = !local && !apiKey.trim() && !hasStoredKey ? t('settings.ai.shared.apiKeyRequired') : undefined
  const modelsError = undefined
  const labelError = mode === 'custom' && !label.trim() ? t('settings.ai.connectDialog.nameRequired') : undefined
  const firstError = labelError ?? urlError ?? keyError ?? modelsError
  const valid = !firstError

  const candidate = (): ProviderConfig => ({
    id,
    vendor: vendor?.id,
    kind,
    label: label.trim() || vendor?.label || kindMeta(kind).label,
    baseUrl: url || kindMeta(kind).defaultBaseUrl || undefined,
    apiKeyRef: apiKey.trim() || provider?.apiKeyRef ? keyRef : undefined,
    models: mergeModels(
      provider?.models ?? [],
      selected.map((mid) => ({
        ...(candidates.find((c) => c.modelId === mid) ?? modelEntryFromId(mid)),
        enabled: false,
      })),
    ),
    lastTest: provider?.lastTest,
    modelsSyncedAt: provider?.modelsSyncedAt,
    ignoredModelIds: provider?.ignoredModelIds,
  })

  const addTyped = () => {
    const mid = typed.trim()
    if (!mid) return
    if (!candidates.some((c) => c.modelId === mid)) setCandidates((c) => [...c, modelEntryFromId(mid)])
    setSelected((s) => (s.includes(mid) ? s : [...s, mid]))
    setTyped('')
  }

  const fetchModels = async () => {
    const request = ++epoch.current
    setFetching(true)
    try {
      const list = await invoke('ai:discoverModels', { provider: candidate(), apiKey: apiKey.trim() || undefined })
      if (request !== epoch.current) return
      if (list.length === 0)
        toast.info(t('settings.ai.connectDialog.noChatModels'), {
          detail: t('settings.ai.connectDialog.noChatModelsDetail'),
        })
      setCandidates([
        ...list,
        ...candidates.filter((m) => m.source === 'manual' && !list.some((r) => r.modelId === m.modelId)),
      ])
      setSelected(
        selected.length
          ? selected.filter(
              (id) =>
                list.some((m) => m.modelId === id) || candidates.some((m) => m.modelId === id && m.source === 'manual'),
            )
          : list.map((m) => m.modelId),
      )
    } catch (e) {
      if (request !== epoch.current) return
      toast.error(t('settings.ai.shared.fetchModelsFailed'), { detail: errorMessage(e) })
    } finally {
      if (request === epoch.current) setFetching(false)
    }
  }

  const runTest = async () => {
    const modelId = selected[0] ?? provider?.models[0]?.modelId
    if (!modelId) {
      toast.error(t('settings.ai.connectDialog.selectModelFirst'))
      return
    }
    testedModel.current = modelId
    const request = ++epoch.current
    setTest({ status: 'testing' })
    try {
      const result = await invoke('ai:testModel', {
        provider: candidate(),
        modelId,
        apiKey: apiKey.trim() || undefined,
      })
      if (request === epoch.current) setTest(testStateFromResult(result))
    } catch (e) {
      if (request === epoch.current) setTest({ status: 'error', message: errorMessage(e) })
    }
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const typedKey = apiKey.trim()
      if (typedKey) await invoke('secret:set', { ref: keyRef, value: typedKey })
      let next = candidate()
      let syncError: string | undefined
      try {
        const remote = await invoke('ai:discoverModels', { provider: next, apiKey: typedKey || undefined })
        next = syncProviderModels(next, remote)
      } catch (e) {
        syncError = errorMessage(e)
      }
      const lastTest =
        test.status === 'ok'
          ? { ok: true, at: Date.now(), latencyMs: test.latencyMs }
          : test.status === 'error'
            ? { ok: false, at: Date.now(), message: test.message }
            : provider?.lastTest
      const models =
        test.status === 'ok'
          ? next.models.map((m) =>
              m.modelId === testedModel.current ? { ...m, supportsTools: test.supportsTools } : m,
            )
          : next.models
      await onSave({ ...next, models, lastTest })
      if (syncError)
        toast.error(t('settings.ai.connectDialog.syncFailed'), {
          detail: t('settings.ai.connectDialog.syncFailedDetail', { error: syncError }),
        })
      if (typedKey) secret.reload()
      onOpenChange(false)
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    void save()
  }

  const status = testStatusLine(test, 'agent')
  const VendorIcon = vendorIconFor(vendor?.id)
  const title = editingOnlyKey
    ? t('settings.ai.connectDialog.editKeyTitle')
    : mode === 'custom'
      ? provider
        ? t('settings.ai.connectDialog.editCustomTitle')
        : t('settings.ai.connectDialog.connectCustomTitle')
      : t('settings.ai.connectDialog.connectVendorTitle', { vendor: vendor?.label ?? '' })
  const description = editingOnlyKey
    ? t('settings.ai.connectDialog.editKeyDescription')
    : local
      ? t('settings.ai.connectDialog.localDescription')
      : vendor
        ? t('settings.ai.connectDialog.vendorDescription')
        : t('settings.ai.connectDialog.customDescription')

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader icon={editingOnlyKey ? KeyRound : Plug} tone="accent" title={title} description={description} />
          <DialogBody className="gap-3.5">
            <fieldset disabled={saving} className="contents">
              {vendor && !editingOnlyKey ? (
                <div className="flex items-center gap-2.5 rounded-item border border-line-6 bg-content px-3 py-2">
                  <VendorIcon size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-2" />
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium text-fg">{vendor.label}</div>
                    <div className="truncate text-note text-fg-3">{vendor.subtitle}</div>
                  </div>
                  {vendor.local ? (
                    <Badge tone="ok">{t('settings.ai.shared.local')}</Badge>
                  ) : (
                    <Badge title={kindMeta(kind).label}>{kindMeta(kind).label}</Badge>
                  )}
                </div>
              ) : null}

              {mode === 'custom' ? (
                <>
                  <Field label={t('settings.ai.connectDialog.name')} htmlFor={`${id}-label`}>
                    <Input
                      id={`${id}-label`}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      onBlur={() => setLabelTouched(true)}
                      placeholder={t('settings.ai.connectDialog.namePlaceholder')}
                      error={labelTouched ? labelError : undefined}
                      autoFocus
                    />
                  </Field>
                  <Field
                    label={t('settings.ai.connectDialog.kind')}
                    htmlFor={`${id}-kind`}
                    hint={t('settings.ai.shared.kindHint')}
                  >
                    <Select
                      id={`${id}-kind`}
                      aria-label={t('settings.ai.connectDialog.kind')}
                      options={kindOptions(t)}
                      value={kind}
                      onValueChange={(k) => {
                        const prev = kindMeta(kind).defaultBaseUrl
                        setKind(k)
                        if (!url || url === prev) setBaseUrl(kindMeta(k).defaultBaseUrl)
                      }}
                      size="lg"
                      fullWidth
                    />
                  </Field>
                </>
              ) : null}

              {!editingOnlyKey ? (
                <Field
                  label={t('settings.ai.connectDialog.baseUrl')}
                  htmlFor={`${id}-url`}
                  hint={vendor ? t('settings.ai.connectDialog.baseUrlVendorHint') : t('settings.ai.shared.baseUrlHint')}
                >
                  <Input
                    id={`${id}-url`}
                    mono
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={kindMeta(kind).defaultBaseUrl || 'https://…'}
                    error={url && urlError ? urlError : undefined}
                  />
                </Field>
              ) : null}

              {!local ? (
                <Field
                  label="API Key"
                  htmlFor={`${id}-key`}
                  trailing={
                    vendor?.keyUrl ? (
                      <a
                        href={vendor.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-5 gap-1 px-1.5')}
                      >
                        {t('settings.ai.connectDialog.getKey')}
                        <ExternalLink size={11} strokeWidth={ICON_STROKE} aria-hidden />
                      </a>
                    ) : null
                  }
                  hint={
                    hasStoredKey ? t('settings.ai.connectDialog.keyStoredHint') : t('settings.ai.shared.keyLocalOnly')
                  }
                >
                  <Input
                    id={`${id}-key`}
                    type="password"
                    mono
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setTest({ status: 'idle' })
                    }}
                    placeholder={hasStoredKey ? t('settings.ai.shared.keySaved') : 'sk-…'}
                    autoComplete="off"
                    autoFocus={editingOnlyKey || Boolean(vendor)}
                  />
                </Field>
              ) : (
                <InlineHint kind="success">{t('settings.ai.shared.localNoKey')}</InlineHint>
              )}

              {!editingOnlyKey ? (
                <Field
                  label={t('settings.ai.connectDialog.models')}
                  hint={modelsError ?? t('settings.ai.connectDialog.modelsHint')}
                  trailing={
                    <IconButton
                      size="xs"
                      icon={ListFilter}
                      label={t('settings.ai.shared.fetchModels')}
                      disabled={Boolean(urlError || keyError) || saving}
                      loading={fetching}
                      onClick={() => void fetchModels()}
                      className="text-fg-3"
                    />
                  }
                >
                  <div
                    className="flex max-h-60 flex-wrap items-center gap-1.5 overflow-y-auto"
                    role="group"
                    aria-label={t('settings.ai.connectDialog.models')}
                  >
                    {candidates.map((m) => {
                      const on = selected.includes(m.modelId)
                      return (
                        <Chip
                          key={m.modelId}
                          label={m.label !== m.modelId ? m.label : m.modelId}
                          selected={on}
                          onClick={() =>
                            setSelected((s) => (on ? s.filter((x) => x !== m.modelId) : [...s, m.modelId]))
                          }
                          title={m.description ? `${m.modelId} · ${m.description}` : m.modelId}
                          className="font-mono"
                        />
                      )
                    })}
                    <Input
                      mono
                      size="sm"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTyped()
                        }
                      }}
                      placeholder={t('settings.ai.connectDialog.typeModelPlaceholder')}
                      aria-label={t('settings.ai.connectDialog.addModelId')}
                      wrapperClassName="w-[190px]"
                      trailing={
                        typed.trim() ? (
                          <IconButton size="xs" icon={Plus} label={t('common.add')} onClick={addTyped} />
                        ) : null
                      }
                    />
                  </div>
                </Field>
              ) : null}
              {test.status !== 'idle' ? <InlineHint kind={status.kind}>{status.text}</InlineHint> : null}
            </fieldset>
          </DialogBody>
          <DialogFooter className="justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void runTest()}
                loading={test.status === 'testing'}
                disabled={saving || fetching || (selected.length === 0 && !provider?.models[0])}
              >
                {t('settings.ai.connectDialog.test')}
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!valid || fetching} title={firstError}>
                {editingOnlyKey ? t('common.save') : t('settings.ai.connectDialog.confirm')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  trailing,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-tab font-medium text-fg-2">
          {label}
        </label>
        <span className="min-w-0 flex-1" />
        {trailing}
      </div>
      {children}
      {hint ? <div className="text-note text-fg-3">{hint}</div> : null}
    </div>
  )
}
