import { useState } from 'react'
/**
 * Right side of the 模型厂商 card (Figma 164:4211 / 164:2055): vendor header with 接入 or 编辑 Key / 断开,
 * then one row per model — name + 推理强度 badge + note | 启用 toggle | ✎ settings. Before 接入 the preset
 * models are listed with disabled toggles so the user sees what they get.
 */
import { KeyRound, Plus, RefreshCw, Unplug } from 'lucide-react'
import { modelCapabilities, type ModelEntry, type ProviderConfig } from '@aiwc/protocol'
import { Badge, Button, Divider, EmptyState, ICON_STROKE, InlineHint, Toggle, Input, cn } from '@/kit'
import { effortLabel, formatContext, isLocalKind, providerStatus, testStatusLine } from '../../aiModel'
import { vendorIconFor } from '../../vendorIcons'
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

export function ProviderPanel({ vendor, provider, testing = false, syncing = false, syncError, onSync, onConnect, onEditKey, onEdit, onTest, onDisconnect, onToggleModel, onPatchModel, onRemoveModel, onAddModel }: ProviderPanelProps) {
  const [query, setQuery] = useState('')
  const status = providerStatus(provider)
  const connected = status !== 'unconfigured'
  const Icon = vendorIconFor(vendor?.id)
  const isNewCustom = !vendor && !provider
  const label = provider?.label ?? vendor?.label ?? '自定义接口'
  const local = provider ? isLocalKind(provider.kind) : Boolean(vendor?.local)
  const models: ModelEntry[] = provider?.models ?? []
  const filtered = models.filter(m => `${m.label} ${m.modelId}`.toLowerCase().includes(query.toLowerCase()))
  const lastTest = provider?.lastTest
  const statusLine = testing
    ? testStatusLine({ status: 'testing' })
    : lastTest
      ? testStatusLine(lastTest.ok ? { status: 'ok', latencyMs: lastTest.latencyMs, supportsTools: provider?.models[0]?.supportsTools ?? true } : { status: 'error', message: lastTest.message ?? '连接失败' })
      : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-2" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-body font-medium text-fg">{label}</span>
          {local ? <Badge tone="ok">本地</Badge> : null}
          {connected ? (
            <span className="flex min-w-0 items-center gap-2">
              {statusLine ? <InlineHint kind={statusLine.kind} className="min-w-0 truncate">{statusLine.text}</InlineHint> : null}
              <Button variant="link" size="sm" className="h-5 px-1.5" onClick={onTest} loading={testing} disabled={models.length === 0}>
                测试连接
              </Button>
            </span>
          ) : (
            <span className="truncate text-caption text-fg-3">{vendor?.subtitle ?? provider?.baseUrl ?? '任何 OpenAI / Anthropic / Gemini 兼容的接口'}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {connected ? (
            <>
              {onEdit ? (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  编辑
                </Button>
              ) : null}
              {!local ? (
                <Button variant="outline" size="sm" icon={KeyRound} onClick={onEditKey}>
                  编辑 Key
                </Button>
              ) : null}
              <Button variant="outline" size="sm" icon={Unplug} onClick={onDisconnect}>
                断开
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onConnect}>
              接入
            </Button>
          )}
        </div>
      </div>
      <Divider />
      {connected ? <div className="flex flex-col gap-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <Input size="sm" aria-label="搜索已接入模型" placeholder="搜索模型…" value={query} onChange={e => setQuery(e.target.value)} wrapperClassName="min-w-0 flex-1" />
          <Button variant="ghost" size="sm" icon={RefreshCw} loading={syncing} onClick={onSync}>刷新模型</Button>
        </div>
        <span className="text-note text-fg-3">{syncing ? '正在从接口同步…' : provider?.modelsSyncedAt ? `上次同步 ${new Date(provider.modelsSyncedAt).toLocaleString()} · ${models.filter(m => m.available !== false).length} 个对话模型` : '接入后自动从接口获取可用模型'}</span>
        {syncError ? <InlineHint kind="error">同步失败：{syncError}。已有配置已保留，可重试或手动添加。</InlineHint> : null}
      </div> : null}
      {models.length === 0 ? (
        <EmptyState compact variant="empty" title={connected ? '还没有模型' : isNewCustom ? '接入自定义服务' : `尚未接入 ${label}`} description={connected ? '添加模型 ID，或从接口拉取模型列表' : isNewCustom ? '填写接口地址与 Key 后，可添加任意平台的模型' : local ? '接入后可从本机 Ollama 拉取已下载的模型' : '接入后可启用它提供的模型，或从接口拉取模型列表'} action={connected ? { label: '添加模型', icon: Plus, onClick: onAddModel, variant: 'ghost' } : undefined} className="flex-1" />
      ) : (
        <ul className="flex max-h-[480px] flex-col overflow-y-auto px-4 py-1" aria-label={`${label} 的模型`}>
          {filtered.map((m) => {
            const enabled = connected && m.enabled !== false && m.available !== false
            const capabilities = modelCapabilities(provider ?? { kind: vendor?.kind ?? 'openai-compatible' }, m)
            const effort = m.reasoningEffort && capabilities.reasoning.includes(m.reasoningEffort) ? effortLabel(m.reasoningEffort) : undefined
            return (
              <li key={m.modelId} className={cn('flex items-center gap-3 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line-6', !connected && 'opacity-60')}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('truncate text-body text-fg', m.label !== m.modelId ? '' : 'font-mono')}>{m.label}</span>
                    {effort ? <Badge tone="info">{effort}</Badge> : null}
                    {m.fast && capabilities.fast ? <Badge tone="accent">快速</Badge> : null}
                    {m.available === false ? <Badge tone="warn">接口未返回</Badge> : null}
                    {!m.supportsTools ? <Badge tone="warn">不支持工具</Badge> : null}
                  </div>
                  <div className="truncate text-caption text-fg-3">
                    {m.description ? <span>{m.description} · </span> : null}
                    {m.label !== m.modelId ? <span className="font-mono">{m.modelId} · </span> : null}
                    <span>{formatContext(m.contextWindow)} 上下文</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-caption text-fg-3">启用</span>
                  <Toggle label={`启用 ${m.label}`} checked={enabled} disabled={!connected || m.available === false} onCheckedChange={(v) => onToggleModel(m.modelId, v)} />
                  <Divider orientation="vertical" strength={8} className="h-3" />
                  <ModelSettingsPopover provider={provider ?? { kind: vendor?.kind ?? 'openai-compatible' }} model={m} disabled={!connected} onPatch={(patch) => onPatchModel(m.modelId, patch)} onRemove={() => onRemoveModel(m.modelId)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {models.length > 0 && !filtered.length ? <EmptyState compact title="没有匹配的模型" description="尝试其他模型名称或 ID" /> : null}
      {connected && models.length > 0 ? (
        <div className="px-3 pb-2">
          <Button variant="link" size="sm" icon={Plus} onClick={onAddModel}>
            添加模型
          </Button>
        </div>
      ) : null}
    </div>
  )
}
