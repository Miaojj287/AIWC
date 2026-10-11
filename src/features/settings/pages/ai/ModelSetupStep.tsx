/**
 * 首次引导 › 接入模型 (rendered by the onboarding wizard through App, so features stay apart): vendor tiles (online
 * vendors and the local Ollama) open the same 接入 dialog as 设置 › AI 接入; after saving, the step makes sure one
 * model is on, sets the default model and tests it. 稍后再说 is always possible, with a note on what waits for a model.
 */
import { ArrowLeft, Check } from 'lucide-react'
import { useState, type ReactNode, type Ref } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, ICON_STROKE, InlineHint, cn, vendorIconFor } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { hasUsableModel } from '@/platform/modelAvailability'
import { resolveDefaultModel, upsertProvider } from '../../aiModel'
import { errorMessage, saveConfig } from '../../hooks'
import { ensureEnabledModel, firstUsableModelId } from '../../modelSetup'
import { VENDORS, type VendorPreset } from '../../vendors'
import { ConnectProviderDialog } from './ConnectProviderDialog'

export interface ModelSetupStepProps {
  onBack(): void
  /** Finish the wizard, with or without a model. */
  onFinish(): void
  stepsBar: ReactNode
  headingRef?: Ref<HTMLHeadingElement>
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing'; label: string }
  | { kind: 'ok'; label: string; models: number; ms?: number }
  | { kind: 'failed'; label: string; message: string; provider: ProviderConfig }

export function ModelSetupStep({ onBack, onFinish, stepsBar, headingRef }: ModelSetupStepProps) {
  const t = useT()
  const ai = useConfig((c) => c.ai)
  const [vendor, setVendor] = useState<VendorPreset | undefined>(undefined)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const providers = ai?.providers ?? []
  const ready = hasUsableModel(providers)

  const runTest = async (provider: ProviderConfig) => {
    const modelId = firstUsableModelId(provider)
    if (!modelId) return
    setTest({ kind: 'testing', label: provider.label })
    try {
      const res = await invoke('ai:testModel', { provider, modelId })
      const models = provider.models.filter((m) => m.enabled !== false).length
      setTest(
        res.ok
          ? { kind: 'ok', label: provider.label, models, ms: res.latencyMs }
          : { kind: 'failed', label: provider.label, message: res.error?.message ?? '', provider },
      )
    } catch (e) {
      setTest({ kind: 'failed', label: provider.label, message: errorMessage(e), provider })
    }
  }

  const save = async (next: ProviderConfig) => {
    const provider = ensureEnabledModel(next)
    const list = upsertProvider(providers, provider)
    if (!(await saveConfig({ ai: { providers: list, defaultModel: resolveDefaultModel(list, ai?.defaultModel) } })))
      throw new Error(t('settings.ai.shared.configWriteFailed'))
    void runTest(provider)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-8 pb-6 pt-8">
          <header className="flex flex-col gap-1">
            <h1 ref={headingRef} tabIndex={-1} className="text-title font-medium leading-7 text-fg">
              {t('settings.setup.title')}
            </h1>
            <p className="text-caption text-fg-3">{t('settings.setup.description')}</p>
          </header>
          <ul
            aria-label={t('settings.setup.vendorsLabel')}
            className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2"
          >
            {VENDORS.map((v) => {
              const connected = providers.some((p) => p.vendor === v.id)
              const Icon = vendorIconFor(v.id)
              return (
                <li key={v.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setVendor(v)}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-3 rounded-card border border-line-6 bg-panel px-3 py-2.5 text-left hover:bg-hover-5 active:bg-hover-7',
                      connected && 'border-ok/30',
                    )}
                  >
                    <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-2" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body font-medium text-fg">{v.label}</span>
                      <span className="truncate text-caption text-fg-3">{v.subtitle}</span>
                    </span>
                    {connected ? (
                      <Badge tone="ok" icon={Check}>
                        {t('settings.setup.connectedBadge')}
                      </Badge>
                    ) : v.local ? (
                      <Badge tone="ok">{t('settings.setup.local')}</Badge>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          <TestLine test={test} onRetest={(p) => void runTest(p)} />
          {!ready ? <p className="m-0 text-caption text-fg-3">{t('settings.setup.skipNote')}</p> : null}
        </div>
      </div>
      <footer className="flex h-[64px] shrink-0 items-center gap-4 border-t border-line-6 px-8">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          {t('settings.setup.back')}
        </Button>
        <div className="flex flex-1 justify-center">{stepsBar}</div>
        {ready ? (
          <Button onClick={onFinish}>{t('settings.setup.finish')}</Button>
        ) : (
          <Button variant="outline" onClick={onFinish}>
            {t('settings.setup.skip')}
          </Button>
        )}
      </footer>
      <ConnectProviderDialog
        open={vendor !== undefined}
        onOpenChange={(open) => !open && setVendor(undefined)}
        mode="connect"
        vendor={vendor}
        provider={vendor ? providers.find((p) => p.vendor === vendor.id) : undefined}
        onSave={save}
      />
    </div>
  )
}

function TestLine({ test, onRetest }: { test: TestState; onRetest: (p: ProviderConfig) => void }) {
  const t = useT()
  switch (test.kind) {
    case 'idle':
      return null
    case 'testing':
      return <InlineHint kind="info">{t('settings.setup.testing')}</InlineHint>
    case 'ok':
      return (
        <InlineHint kind="success" live>
          {t('settings.setup.connected', { label: test.label, n: test.models })}
          {test.ms !== undefined ? ` · ${t('settings.setup.testOk', { ms: Math.round(test.ms) })}` : ''}
        </InlineHint>
      )
    case 'failed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <InlineHint kind="error">{t('settings.setup.testFailed', { message: test.message })}</InlineHint>
          <Button variant="link" size="sm" onClick={() => onRetest(test.provider)}>
            {t('settings.setup.retest')}
          </Button>
        </div>
      )
  }
}
