/**
 * 设置 › AI 接入 › 网络 — proxy for requests to model providers: follow the system, a manual http / https / socks5
 * proxy (optional sign-in, the password in the keychain), or none, plus addresses that skip it. Loopback (Ollama)
 * is always direct. Text fields commit on blur / Enter when valid; 测试代理 reaches the default model's endpoint.
 */
import { Globe, Monitor, PlugZap, Unplug } from 'lucide-react'
import { useState } from 'react'
import {
  PROXY_PASSWORD_SECRET_REF,
  parseBypassList,
  parseProxyUrl,
  type InvokeRes,
  type ProxyConfig,
  type ProxyMode,
} from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Card, InlineHint, Input, SegmentedControl, Textarea, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { errorMessage, saveConfig, useSecretPresence } from '../../hooks'
import { SRow, Section } from '../../pageKit'

type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: InvokeRes<'models:testProxy'> }

export function NetworkSection() {
  const t = useT()
  const proxy = useConfig((c) => c.ai.proxy)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  if (!proxy) return null

  const save = (patch: Partial<ProxyConfig>) => saveConfig({ ai: { proxy: { ...proxy, ...patch } } })
  const runTest = async () => {
    setTest({ kind: 'running' })
    try {
      setTest({ kind: 'done', result: await invoke('models:testProxy', {}) })
    } catch (e) {
      setTest({ kind: 'done', result: { ok: false, route: 'direct', errorCode: 'network', detail: errorMessage(e) } })
    }
  }

  return (
    <Section title={t('settings.network.section')} help={t('settings.network.help')}>
      <Card variant="rows">
        <SRow id="ai.proxy" title={t('settings.network.mode.title')}>
          <SegmentedControl<ProxyMode>
            aria-label={t('settings.network.mode.title')}
            value={proxy.mode}
            options={[
              { value: 'system', label: t('settings.network.mode.system'), icon: Monitor },
              { value: 'manual', label: t('settings.network.mode.manual'), icon: Globe },
              { value: 'off', label: t('settings.network.mode.off'), icon: Unplug },
            ]}
            onValueChange={(mode) => {
              setTest({ kind: 'idle' })
              void save({ mode })
            }}
          />
        </SRow>
        {/* Keyed by the saved values: a change from elsewhere (another window, a reset) re-seeds the drafts. */}
        {proxy.mode === 'manual' ? (
          <ManualProxyRows key={`${proxy.url}|${proxy.username}`} proxy={proxy} save={save} />
        ) : null}
        <BypassRow key={proxy.bypass.join('\n')} proxy={proxy} save={save} />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Button
            variant="outline"
            icon={PlugZap}
            loading={test.kind === 'running'}
            disabled={proxy.mode === 'manual' && !parseProxyUrl(proxy.url).ok}
            disabledReason={t('settings.network.url.errors.empty')}
            onClick={() => void runTest()}
          >
            {t('settings.network.test.button')}
          </Button>
          {test.kind === 'done' ? <TestResult result={test.result} /> : null}
        </div>
      </Card>
    </Section>
  )
}

function TestResult({ result }: { result: InvokeRes<'models:testProxy'> }) {
  const t = useT()
  if (result.ok)
    return (
      <InlineHint kind="success" truncate>
        {result.route === 'proxy' && result.proxy
          ? t('settings.network.test.okProxy', { proxy: result.proxy, ms: result.latencyMs ?? 0 })
          : t('settings.network.test.okDirect', { ms: result.latencyMs ?? 0 })}
      </InlineHint>
    )
  const reason = result.errorCode
    ? t(`settings.network.test.errors.${result.errorCode}`)
    : t('settings.network.test.failed')
  return (
    <InlineHint kind="error" truncate title={result.detail}>
      {result.detail ? `${reason} · ${result.detail}` : reason}
    </InlineHint>
  )
}

interface RowProps {
  proxy: ProxyConfig
  save: (patch: Partial<ProxyConfig>) => Promise<boolean>
}

function ManualProxyRows({ proxy, save }: RowProps) {
  const t = useT()
  const [url, setUrl] = useState(proxy.url ?? '')
  const [username, setUsername] = useState(proxy.username ?? '')
  const [password, setPassword] = useState('')
  const [secretVersion, setSecretVersion] = useState(0)
  const stored = useSecretPresence(PROXY_PASSWORD_SECRET_REF, secretVersion)

  const check = parseProxyUrl(url)
  const urlError = url.trim() && !check.ok ? t(`settings.network.url.errors.${check.code}`) : undefined
  const commitUrl = () => {
    if (check.ok && check.normalized !== proxy.url) void save({ url: check.normalized })
  }
  const commitUsername = () => {
    const next = username.trim() || undefined
    if (next !== proxy.username) void save({ username: next })
  }
  const commitPassword = async () => {
    if (!password) return
    try {
      await invoke('secret:set', { ref: PROXY_PASSWORD_SECRET_REF, value: password })
      setPassword('')
      setSecretVersion((v) => v + 1)
      if (proxy.passwordRef !== PROXY_PASSWORD_SECRET_REF) await save({ passwordRef: PROXY_PASSWORD_SECRET_REF })
      toast.success(t('settings.network.saved'))
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    }
  }
  const clearPassword = async () => {
    try {
      await invoke('secret:delete', { ref: PROXY_PASSWORD_SECRET_REF })
      await save({ passwordRef: undefined })
      setSecretVersion((v) => v + 1)
      toast.success(t('settings.network.auth.passwordCleared'))
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    }
  }

  return (
    <>
      <SRow id="ai.proxyUrl" title={t('settings.network.url.title')} htmlFor="ai-proxy-url">
        <Input
          id="ai-proxy-url"
          mono
          value={url}
          placeholder={t('settings.network.url.placeholder')}
          error={urlError}
          wrapperClassName="w-[240px]"
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </SRow>
      <SRow
        id="ai.proxyAuth"
        title={t('settings.network.auth.title')}
        description={t('settings.network.auth.description')}
      >
        <div className="flex flex-wrap items-start justify-end gap-2">
          <Input
            aria-label={t('settings.network.auth.username')}
            placeholder={t('settings.network.auth.username')}
            value={username}
            autoComplete="off"
            wrapperClassName="w-[140px]"
            onChange={(e) => setUsername(e.target.value)}
            onBlur={commitUsername}
          />
          <Input
            type="password"
            aria-label={t('settings.network.auth.password')}
            placeholder={stored.has ? t('settings.network.auth.passwordSaved') : t('settings.network.auth.password')}
            value={password}
            autoComplete="new-password"
            wrapperClassName="w-[160px]"
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => void commitPassword()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          {stored.has ? (
            <Button variant="link" size="sm" onClick={() => void clearPassword()}>
              {t('settings.network.auth.clearPassword')}
            </Button>
          ) : null}
        </div>
      </SRow>
    </>
  )
}

function BypassRow({ proxy, save }: RowProps) {
  const t = useT()
  const [text, setText] = useState(proxy.bypass.join('\n'))
  const commit = () => {
    const next = parseBypassList(text)
    if (next.join('\n') !== proxy.bypass.join('\n')) void save({ bypass: next })
  }
  return (
    <SRow
      id="ai.proxyBypass"
      stacked
      title={t('settings.network.bypass.title')}
      help={t('settings.network.bypass.help')}
    >
      <Textarea
        mono
        autosize
        minRows={2}
        maxRows={6}
        aria-label={t('settings.network.bypass.title')}
        placeholder={t('settings.network.bypass.placeholder')}
        disabled={proxy.mode === 'off'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
    </SRow>
  )
}
