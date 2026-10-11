/**
 * Card ② 密钥 (Figma 135:415 下半 / 155:415 ②): header 自动获取 → progress dialog; per-key rows with
 * masked value, reveal toggle, manual paste with 64-hex validation; failed rows red with 重试 / 内存扫描.
 */
import { Check, CircleAlert, Eye, EyeOff, KeyRound, RefreshCw, ScanSearch, Settings, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, FieldLabel, IconButton, InlineHint, Input, TaskProgress, cn, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import { DEVELOPER_TOOLS_SETTINGS_URL, keyAcquireView, useClock } from '@/platform/wechatKeys'
import { KEY_KINDS, KEY_META, hasKey, summariseKeys, type KeyKind, type KeyState } from './gating'
import { useWizardStore } from './wizardStore'

const KEY_REFS: Record<KeyKind, keyof AppConfig['account']> = {
  db_key: 'dbKeyRef',
  image_xor: 'imageXorKeyRef',
  image_aes: 'imageAesKeyRef',
}

/** Masked value of an acquired key; 👁 reads the real hex from the secret store (default masked, CLAUDE.md §6). */
function AcquiredKeyInput({
  kind,
  state,
}: {
  kind: KeyKind
  state: Extract<KeyState, { status: 'acquired' | 'manual' }>
}) {
  const t = useT()
  const ref =
    useConfig((c) => c.account[KEY_REFS[kind]]) ||
    ({ db_key: 'account:dbKey', image_xor: 'account:imageXorKey', image_aes: 'account:imageAesKey' } as const)[kind]
  const [revealed, setRevealed] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setRevealed(undefined), [ref, state])
  const meta = KEY_META[kind]
  const known = state.status === 'manual' ? state.hex : revealed
  const toggle = async () => {
    if (known && revealed) {
      setRevealed(undefined)
      return
    }
    if (state.status === 'manual') {
      setRevealed(state.hex)
      return
    }
    if (typeof ref !== 'string' || !ref) {
      toast.info(t('onboarding.keys.storedNotViewable'))
      return
    }
    setBusy(true)
    try {
      const hex = await invoke('secret:reveal', { ref })
      if (hex) setRevealed(hex)
      else toast.info(t('onboarding.keys.notInStore'))
    } catch (e) {
      toast.error(t('onboarding.keys.revealFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }
  const shown = revealed !== undefined
  return (
    <Input
      mono
      readOnly
      revealable={false}
      value={shown ? (known ?? '') : '•'.repeat(Math.min(meta.hexLength, 48))}
      aria-label={t('onboarding.keys.acquiredAria', { label: t(meta.label) })}
      wrapperClassName="flex-[3]"
      trailing={
        <>
          <IconButton
            size="xs"
            icon={shown ? EyeOff : Eye}
            label={shown ? t('onboarding.keys.hide') : t('onboarding.keys.reveal')}
            loading={busy}
            onClick={() => void toggle()}
            className="text-fg-3"
          />
          <Badge tone="ok">
            {state.status === 'acquired' && state.source === 'cached'
              ? t('onboarding.keys.cached')
              : state.status === 'manual'
                ? t('onboarding.keys.manual')
                : t('onboarding.keys.acquired')}
          </Badge>
        </>
      }
    />
  )
}

function KeyRow({ kind, state, wide = false }: { kind: KeyKind; state: KeyState; wide?: boolean }) {
  const t = useT()
  const setManualKey = useWizardStore((s) => s.setManualKey)
  const clearKey = useWizardStore((s) => s.clearKey)
  const acquire = useWizardStore((s) => s.acquire)
  const acquiring = useWizardStore((s) => s.acquiring)
  // While the progress panel shows the failed run, it carries the reason and the retry actions.
  const panelShowsFailure = useWizardStore((s) => s.acquireFailed)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const meta = KEY_META[kind]
  const present = hasKey(state)

  useEffect(() => {
    if (present) {
      setDraft('')
      setError(undefined)
    }
  }, [present])

  const commit = async () => {
    if (!draft.trim() || saving || acquiring) return
    setSaving(true)
    const res = await setManualKey(kind, draft)
    setSaving(false)
    setError(res.ok ? undefined : res.error)
  }

  const failed = state.status === 'failed'

  return (
    <div className={cn('flex flex-col gap-1.5', wide && 'col-span-2')}>
      <div
        className={cn(
          'flex items-center gap-3 rounded-item border p-2',
          failed ? 'border-danger/40 bg-danger/5' : 'border-line-6 bg-content',
        )}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-item',
            present ? 'bg-ok/15 text-ok' : failed ? 'bg-danger/15 text-danger' : 'bg-accent-15 text-accent',
          )}
        >
          {present ? (
            <Check size={15} strokeWidth={2} aria-hidden />
          ) : failed ? (
            <CircleAlert size={15} strokeWidth={1.75} aria-hidden />
          ) : (
            <KeyRound size={15} strokeWidth={1.75} aria-hidden />
          )}
        </span>
        {/* Grows with the row (English labels run longer); the key field keeps three times the share. */}
        <div className="flex min-w-32 flex-1 flex-col gap-0.5">
          <span
            className={cn('truncate text-body font-medium', failed ? 'text-danger' : 'text-fg')}
            title={t(meta.label)}
          >
            {t(meta.label)}
          </span>
          <span className="truncate text-micro text-fg-3" title={t(meta.description)}>
            {t(meta.description)}
          </span>
        </div>
        {state.status === 'acquired' || state.status === 'manual' ? (
          <AcquiredKeyInput kind={kind} state={state} />
        ) : (
          <Input
            mono
            type="password"
            value={draft}
            placeholder={
              kind === 'image_aes'
                ? t('onboarding.keys.pasteAes')
                : t('onboarding.keys.pasteHex', { n: meta.hexLength })
            }
            onChange={(e) => {
              setDraft(e.target.value)
              setError(undefined)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void commit()}
            disabled={saving || acquiring}
            error={Boolean(error)}
            aria-label={t(meta.label)}
            wrapperClassName="flex-[3]"
          />
        )}
        {!present ? (
          <Button
            variant="outline"
            size="sm"
            loading={saving}
            disabled={!draft.trim() || acquiring}
            onClick={() => void commit()}
          >
            {t('common.save')}
          </Button>
        ) : null}
        {present ? (
          <Button variant="ghost" size="sm" onClick={() => clearKey(kind)} disabled={acquiring}>
            {t('onboarding.keys.clear')}
          </Button>
        ) : null}
      </div>
      {error ? <InlineHint kind="error">{error}</InlineHint> : null}
      {failed && !panelShowsFailure ? (
        <div className="flex items-center gap-2">
          <InlineHint kind="error" className="min-w-0 flex-1">
            {state.error}
          </InlineHint>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void acquire('auto')} disabled={acquiring}>
            {t('common.retry')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={ScanSearch}
            onClick={() => void acquire('memory_scan')}
            disabled={acquiring}
          >
            {t('onboarding.keys.memoryScan')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Inline key-acquire progress below the key rows (CLAUDE.md §4.5): one line naming the current stage
 * (with what to do and a countdown when it waits on the user), elapsed time, ✓/⟳/○/! steps and 取消.
 * A failed run stays visible with its reason and 重试 until dismissed or re-run.
 */
function KeyAcquireProgress() {
  const t = useT()
  const acquiring = useWizardStore((s) => s.acquiring)
  const failed = useWizardStore((s) => s.acquireFailed)
  const steps = useWizardStore((s) => s.acquireSteps)
  const startedAt = useWizardStore((s) => s.acquireStartedAt)
  const cancelAcquire = useWizardStore((s) => s.cancelAcquire)
  const dismiss = useWizardStore((s) => s.dismissAcquireResult)
  const acquire = useWizardStore((s) => s.acquire)
  const now = useClock(acquiring)
  if (!acquiring && !failed) return null
  const view = keyAcquireView(steps, { running: acquiring, startedAt, now })
  return (
    <TaskProgress
      {...view}
      onCancel={cancelAcquire}
      actions={
        view.state === 'failed' ? (
          <>
            <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => void acquire('auto')}>
              {t('common.retry')}
            </Button>
            {view.needsSettings ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Settings}
                onClick={() => void openUrl(DEVELOPER_TOOLS_SETTINGS_URL)}
              >
                {t('app.keyAcquire.openSettings')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" icon={ScanSearch} onClick={() => void acquire('memory_scan')}>
                {t('onboarding.keys.memoryScan')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t('common.close')}
            </Button>
          </>
        ) : undefined
      }
    />
  )
}

export function KeysCard() {
  const t = useT()
  const keys = useWizardStore((s) => s.keys)
  const acquiring = useWizardStore((s) => s.acquiring)
  const acquire = useWizardStore((s) => s.acquire)
  const wxid = useWizardStore((s) => s.wxid)
  const dbRoot = useWizardStore((s) => s.dbRoot)
  const summary = summariseKeys(keys)
  const canAcquire = Boolean(wxid && dbRoot) && !acquiring

  const status = acquiring
    ? { kind: 'info' as const, text: t('onboarding.keys.acquiring') }
    : summary.complete
      ? { kind: 'success' as const, text: t('onboarding.keys.allAcquired') }
      : summary.failed.length
        ? { kind: 'error' as const, text: t('onboarding.keys.progress', { done: summary.done, total: summary.total }) }
        : summary.done
          ? {
              kind: 'warning' as const,
              text: t('onboarding.keys.progress', { done: summary.done, total: summary.total }),
            }
          : undefined

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <FieldLabel
          icon={KeyRound}
          label={t('onboarding.keys.label')}
          help={t('onboarding.keys.help')}
          hint={t('onboarding.keys.hint')}
          status={status}
          className="min-w-0 flex-1"
        />
        <Button
          // Accent only while nothing has been acquired yet; afterwards 重新获取 is a secondary action.
          variant={summary.done > 0 ? 'outline' : 'primary'}
          icon={Sparkles}
          loading={acquiring}
          onClick={() => void acquire('auto')}
          disabled={!canAcquire}
          disabledReason={!wxid || !dbRoot ? t('onboarding.keys.selectFirst') : undefined}
        >
          {acquiring
            ? t('onboarding.keys.acquiring')
            : summary.done > 0
              ? t('onboarding.keys.acquireAgain')
              : t('onboarding.keys.acquire')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KeyRow kind="db_key" state={keys.db_key} wide />
        {KEY_KINDS.filter((k) => k !== 'db_key').map((k) => (
          <KeyRow key={k} kind={k} state={keys[k]} />
        ))}
      </div>
      <KeyAcquireProgress />
      {!summary.complete && summary.done > 0 && !acquiring && summary.failed.length === 0 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={ScanSearch}
            onClick={() => void acquire('memory_scan')}
            disabled={!canAcquire}
          >
            {t('onboarding.keys.acquireImageKeys')}
          </Button>
          <span className="text-note text-fg-3">{t('onboarding.keys.imageKeysLater')}</span>
        </div>
      ) : null}
    </Card>
  )
}
