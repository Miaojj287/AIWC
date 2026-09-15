import { useState } from 'react'
/**
 * Right side of the 模型厂商 card (Figma 164:4211 / 164:2055): vendor header with 接入 or 编辑 Key / 断开,
 * then one row per model — name + 推理强度 badge + note | 启用 toggle | ✎ settings. Before 接入 the preset
 * models are listed with disabled toggles so the user sees what they get.
 */
import { KeyRound, Plus, RefreshCw, Unplug } from 'lucide-react'
import { modelCapabilities, type ModelEntry, type ProviderConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Divider, EmptyState, ICON_STROKE, InlineHint, Toggle, Input, cn, vendorIconFor } from '@/kit'
import { formatTime } from '@/platform/format'
import { effortLabel, formatContext, isLocalKind, providerStatus, testStatusLine } from '../../aiModel'
import { type VendorPreset } from '../../vendors'
import { ModelSettingsPopover } from './ModelSettingsPopover'

export interface ProviderPanelProps {
  vendor?: VendorPreset
  provider?: ProviderConfig
  testing?: boolean
  syncing?: boolean
  syncError?: string
  onSync?: () => void
  onConnect: () => void
  onEditKey: () => void
  onEdit?: () => void
  onTest: () => void
  onDisconnect: () => void
  onToggleModel: (modelId: string, enabled: boolean) => void
  onPatchModel: (modelId: string, patch: Partial<ModelEntry>) => void
  onRemoveModel: (modelId: string) => void
  onAddModel: () => void
}

export function ProviderPanel({
  vendor,
  provider,
  testing = false,
  syncing = false,
  syncError,
  onSync,
  onConnect,
  onEditKey,
  onEdit,
  onTest,
  onDisconnect,
  onToggleModel,
  onPatchModel,
  onRemoveModel,
  onAddModel,
}: ProviderPanelProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const status = providerStatus(provider)
  const connected = status !== 'unconfigured'
  const Icon = vendorIconFor(vendor?.id)
  const isNewCustom = !vendor && !provider
  const label = provider?.label ?? vendor?.label ?? t('settings.ai.panel.customEndpoint')
  const local = provider ? isLocalKind(provider.kind) : Boolean(vendor?.local)
  const models: ModelEntry[] = provider?.models ?? []
  const filtered = models.filter((m) => `${m.label} ${m.modelId}`.toLowerCase().includes(query.toLowerCase()))
  const lastTest = provider?.lastTest
  const statusLine = testing
    ? testStatusLine({ status: 'testing' })
    : lastTest
      ? testStatusLine(
          lastTest.ok
            ? { status: 'ok', latencyMs: lastTest.latencyMs, supportsTools: provider?.models[0]?.supportsTools ?? true }
            : { status: 'error', message: lastTest.message ?? t('settings.ai.shared.connectFailed') },
        )
      : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-2" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 max-w-full truncate text-body font-medium text-fg">{label}</span>
          {local ? <Badge tone="ok">{t('settings.ai.shared.local')}</Badge> : null}
          {connected ? (
            <span className="flex min-w-0 items-center gap-2">
              {statusLine ? (
                <InlineHint kind={statusLine.kind} truncate>
                  {statusLine.text}
                </InlineHint>
              ) : null}
              <Button
                variant="link"
                size="sm"
                className="h-5 px-1.5"
                onClick={onTest}
                loading={testing}
                disabled={models.length === 0}
              >
                {t('settings.ai.shared.testConnection')}
              </Button>
            </span>
          ) : (
            <span className="min-w-0 truncate text-caption text-fg-3">
              {vendor?.subtitle ?? provider?.baseUrl ?? t('settings.ai.panel.compatibleEndpoint')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {connected ? (
            <>
              {onEdit ? (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  {t('common.edit')}
                </Button>
              ) : null}
              {!local ? (
                <Button variant="outline" size="sm" icon={KeyRound} onClick={onEditKey}>
                  {t('settings.ai.panel.editKey')}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" icon={Unplug} onClick={onDisconnect}>
                {t('settings.ai.shared.disconnect')}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onConnect}>
              {t('settings.ai.panel.connect')}
            </Button>
          )}
        </div>
      </div>
      <Divider />
      {connected ? (
        <div className="flex flex-col gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              aria-label={t('settings.ai.panel.searchConnected')}
              placeholder={t('settings.ai.shared.searchModels')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              wrapperClassName="min-w-0 flex-1"
            />
            <Button variant="ghost" size="sm" icon={RefreshCw} loading={syncing} onClick={onSync}>
              {t('settings.ai.panel.refreshModels')}
            </Button>
          </div>
          <span className="text-note text-fg-3">
            {syncing
              ? t('settings.ai.panel.syncing')
              : provider?.modelsSyncedAt
                ? t('settings.ai.panel.syncedSummary', {
                    n: models.filter((m) => m.available !== false).length,
                    time: formatTime(provider.modelsSyncedAt),
                  })
                : t('settings.ai.panel.syncHint')}
          </span>
          {syncError ? (
            <InlineHint kind="error">{t('settings.ai.panel.syncFailed', { error: syncError })}</InlineHint>
          ) : null}
        </div>
      ) : null}
      {models.length === 0 ? (
        <EmptyState
          compact
          variant="empty"
          title={
            connected
              ? t('settings.ai.panel.emptyTitle')
              : isNewCustom
                ? t('settings.ai.panel.newCustomTitle')
                : t('settings.ai.panel.notConnectedTitle', { label })
          }
          description={
            connected
              ? t('settings.ai.panel.emptyDescription')
              : isNewCustom
                ? t('settings.ai.panel.newCustomDescription')
                : local
                  ? t('settings.ai.panel.localDescription')
                  : t('settings.ai.panel.notConnectedDescription')
          }
          action={
            connected
              ? { label: t('settings.ai.panel.addModel'), icon: Plus, onClick: onAddModel, variant: 'ghost' }
              : undefined
          }
          className="flex-1"
        />
      ) : (
        <ul
          className="flex max-h-[480px] flex-col overflow-y-auto px-4 py-1"
          aria-label={t('settings.ai.panel.modelsOf', { label })}
        >
          {filtered.map((m) => {
            const enabled = connected && m.enabled !== false && m.available !== false
            const capabilities = modelCapabilities(provider ?? { kind: vendor?.kind ?? 'openai-compatible' }, m)
            const effort =
              m.reasoningEffort && capabilities.reasoning.includes(m.reasoningEffort)
                ? effortLabel(m.reasoningEffort)
                : undefined
            return (
              <li
                key={m.modelId}
                className={cn(
                  'flex items-center gap-3 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line-6',
                  !connected && 'opacity-60',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn('min-w-0 truncate text-body text-fg', m.label !== m.modelId ? '' : 'font-mono')}
                    >
                      {m.label}
                    </span>
                    {effort ? <Badge tone="info">{effort}</Badge> : null}
                    {m.fast && capabilities.fast ? <Badge tone="accent">{t('settings.ai.panel.fast')}</Badge> : null}
                    {m.available === false ? <Badge tone="warn">{t('settings.ai.panel.notListed')}</Badge> : null}
                    {!m.supportsTools ? <Badge tone="warn">{t('settings.ai.panel.noTools')}</Badge> : null}
                  </div>
                  <div className="truncate text-caption text-fg-3">
                    {m.description ? <span>{m.description} · </span> : null}
                    {m.label !== m.modelId ? <span className="font-mono">{m.modelId} · </span> : null}
                    <span>{t('settings.ai.panel.context', { size: formatContext(m.contextWindow) })}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-caption text-fg-3">{t('common.enable')}</span>
                  <Toggle
                    label={t('settings.ai.panel.enableModel', { name: m.label })}
                    checked={enabled}
                    disabled={!connected || m.available === false}
                    onCheckedChange={(v) => onToggleModel(m.modelId, v)}
                  />
                  <Divider orientation="vertical" strength={8} className="h-3" />
                  <ModelSettingsPopover
                    provider={provider ?? { kind: vendor?.kind ?? 'openai-compatible' }}
                    model={m}
                    disabled={!connected}
                    onPatch={(patch) => onPatchModel(m.modelId, patch)}
                    onRemove={() => onRemoveModel(m.modelId)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {models.length > 0 && !filtered.length ? (
        <EmptyState
          compact
          title={t('settings.ai.panel.noMatch')}
          description={t('settings.ai.panel.noMatchDescription')}
        />
      ) : null}
      {connected && models.length > 0 ? (
        <div className="px-3 pb-2">
          <Button variant="link" size="sm" icon={Plus} onClick={onAddModel}>
            {t('settings.ai.panel.addModel')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
