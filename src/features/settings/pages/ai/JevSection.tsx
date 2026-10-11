/**
 * 设置 › AI 接入 › Jev 决策模型（beta）: the TypeSafe key (secret store), model alias, endpoint and a
 * connection test — the decision model behind 自动回复的 Jev（beta）回复方式. One rows card, SRow per setting so
 * the settings search can land on each (rows ai.jev / ai.jevKey / ai.jevTest).
 */
import { Eraser, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { JEV_DEFAULT_BASE_URL, JEV_DEFAULT_MODEL, JEV_MODEL_ALIASES, type JevConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Card, DangerDialog, InlineHint, Input, Select, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import { errorMessage, saveConfig, useSecretPresence } from '../../hooks'
import { SRow, Section } from '../../pageKit'

/** Same ref the main process reads (electron/main/config/secretStore.ts SECRET_REFS.jevApiKey). */
export const JEV_API_KEY_REF = 'ai.jev.apiKey'
const JEV_KEYS_URL = 'https://console.typesafe.ai/keys'
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

export function JevSection() {
  const t = useT()
  const jev = useConfig((c) => c.ai.jev)
  const [version, setVersion] = useState(0)
  const secret = useSecretPresence(JEV_API_KEY_REF, version)
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  if (!jev) return null

  const hasKey = Boolean(jev.apiKeyRef) && secret.has !== false
  const patch = (next: Partial<JevConfig>) => saveConfig({ ai: { jev: { ...jev, ...next } } })

  const saveKey = async () => {
    const value = typed.trim()
    if (!value) return
    setSaving(true)
    try {
      await invoke('secret:set', { ref: JEV_API_KEY_REF, value })
      if (await patch({ apiKeyRef: JEV_API_KEY_REF, lastTest: undefined })) {
        setTyped('')
        setVersion((v) => v + 1)
        toast.success(t('settings.ai.jev.keySaved'))
      }
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async () => {
    setConfirmClear(false)
    try {
      await invoke('secret:delete', { ref: JEV_API_KEY_REF })
      if (await patch({ apiKeyRef: undefined, lastTest: undefined })) {
        setVersion((v) => v + 1)
        toast.success(t('settings.ai.jev.keyCleared'))
      }
    } catch (e) {
      toast.error(t('common.operationFailed'), { detail: errorMessage(e) })
    }
  }

  const runTest = async () => {
    setTesting(true)
    try {
      const res = await invoke('jev:test', { apiKey: typed.trim() || undefined })
      await patch({
        lastTest: res.ok
          ? { ok: true, at: Date.now(), latencyMs: res.latencyMs }
          : { ok: false, at: Date.now(), message: res.error },
      })
      if (res.ok)
        toast.success(t('settings.ai.jev.testOk'), {
          detail:
            res.latencyMs !== undefined
              ? t('settings.ai.page.testLatency', { ms: Math.round(res.latencyMs) })
              : undefined,
        })
      else toast.error(t('settings.ai.jev.testFailed'), { detail: res.error })
    } catch (e) {
      toast.error(t('settings.ai.jev.testFailed'), { detail: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const commitBaseUrl = () => {
    if (baseUrlDraft === null) return
    const value = baseUrlDraft.trim() || JEV_DEFAULT_BASE_URL
    setBaseUrlDraft(null)
    if (!URL_RE.test(value)) {
      toast.error(t('settings.ai.shared.urlScheme'))
      return
    }
    if (value !== jev.baseUrl) void patch({ baseUrl: value, lastTest: undefined })
  }

  const testStatus = !jev.lastTest
    ? t('settings.ai.test.idle')
    : jev.lastTest.ok
      ? jev.lastTest.latencyMs !== undefined
        ? t('settings.ai.test.connectedLatency', { ms: Math.round(jev.lastTest.latencyMs) })
        : t('settings.ai.test.connected')
      : t('settings.ai.jev.testFailedStatus', { message: jev.lastTest.message ?? '' })

  return (
    <Section
      id="ai.jev"
      title={t('settings.ai.jev.section')}
      help={t('settings.ai.jev.help')}
      actions={
        <Button variant="link" size="sm" icon={ExternalLink} onClick={() => void openUrl(JEV_KEYS_URL)}>
          {t('settings.ai.jev.getKey')}
        </Button>
      }
    >
      <Card variant="rows">
        <SRow id="ai.jevKey" title={t('settings.ai.jev.apiKey')} stacked htmlFor="jev-api-key">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="jev-api-key"
              type="password"
              mono
              value={typed}
              placeholder={hasKey ? t('settings.ai.shared.keySaved') : t('settings.ai.jev.apiKeyPlaceholder')}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveKey()
              }}
              wrapperClassName="min-w-[220px] flex-1"
              autoComplete="off"
            />
            <Button
              variant="outline"
              loading={saving}
              disabled={!typed.trim()}
              disabledReason={t('settings.ai.jev.keyRequired')}
              onClick={() => void saveKey()}
            >
              {t('settings.ai.jev.saveKey')}
            </Button>
            {hasKey ? (
              <Button variant="ghost" icon={Eraser} onClick={() => setConfirmClear(true)}>
                {t('settings.ai.jev.clearKey')}
              </Button>
            ) : null}
          </div>
        </SRow>
        <SRow
          id="ai.jevModel"
          title={t('settings.ai.jev.model')}
          help={t('settings.ai.jev.modelDescription')}
          htmlFor="jev-model"
        >
          <Select
            id="jev-model"
            aria-label={t('settings.ai.jev.model')}
            value={jev.model || JEV_DEFAULT_MODEL}
            options={JEV_MODEL_ALIASES.map((alias) => ({ value: alias, label: alias }))}
            onValueChange={(model) => void patch({ model, lastTest: undefined })}
            align="end"
            className="min-w-[150px]"
          />
        </SRow>
        <SRow
          id="ai.jevUrl"
          title={t('settings.ai.jev.baseUrl')}
          help={t('settings.ai.jev.baseUrlDescription')}
          htmlFor="jev-base-url"
        >
          <Input
            id="jev-base-url"
            mono
            value={baseUrlDraft ?? jev.baseUrl}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            onBlur={commitBaseUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitBaseUrl()
            }}
            wrapperClassName="w-[260px] max-w-full"
          />
        </SRow>
        <SRow
          id="ai.jevTest"
          title={t('settings.ai.jev.status')}
          description={testStatus}
          footer={
            jev.lastTest && !jev.lastTest.ok && jev.lastTest.message ? (
              <InlineHint kind="error">{jev.lastTest.message}</InlineHint>
            ) : null
          }
        >
          <Button
            variant="outline"
            loading={testing}
            disabled={!hasKey && !typed.trim()}
            disabledReason={t('settings.ai.jev.keyRequired')}
            onClick={() => void runTest()}
          >
            {t('settings.ai.shared.testConnection')}
          </Button>
        </SRow>
      </Card>
      <DangerDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('settings.ai.jev.clearTitle')}
        description={t('settings.ai.jev.clearDescription')}
        confirmLabel={t('settings.ai.jev.clearKey')}
        onConfirm={clearKey}
      />
    </Section>
  )
}
