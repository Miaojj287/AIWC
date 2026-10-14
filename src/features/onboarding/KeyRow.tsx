import { Check, CircleAlert, KeyRound, RefreshCw, ScanSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { Badge, Button, DangerDialog, Input, InlineHint, cn, toast } from '@/kit'
import { KEY_META, hasKey, type KeyKind, type KeyState } from './gating'
import { useWizardStore } from './wizardStore'

/** Advanced manual-key editing; saved credentials remain masked and account scoped. */
export function KeyRow({ kind, state, wide = false }: { kind: KeyKind; state: KeyState; wide?: boolean }) {
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
  const [confirmingClear, setConfirmingClear] = useState(false)
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

  const confirmClear = async () => {
    await clearKey(kind)
    setConfirmingClear(false)
    toast.success(t('onboarding.keys.cleared', { label: t(meta.label) }))
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
          <Input
            mono
            readOnly
            revealable={false}
            value={'•'.repeat(Math.min(meta.hexLength, 48))}
            aria-label={t('onboarding.keys.acquiredAria', { label: t(meta.label) })}
            wrapperClassName="flex-[3]"
            trailing={
              <Badge tone="ok">
                {t(state.status === 'manual' ? 'onboarding.keys.manual' : 'onboarding.keys.cached')}
              </Badge>
            }
          />
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
          <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)} disabled={acquiring}>
            {t('onboarding.keys.clear')}
          </Button>
        ) : null}
      </div>
      <DangerDialog
        open={confirmingClear}
        onOpenChange={setConfirmingClear}
        title={t('onboarding.keys.clearConfirmTitle')}
        description={t('onboarding.keys.clearConfirmDescription', { label: t(meta.label) })}
        confirmLabel={t('onboarding.keys.clear')}
        onConfirm={confirmClear}
      />
      {error ? <InlineHint kind="error">{error}</InlineHint> : null}
      {failed && !panelShowsFailure ? (
        <div className="flex items-center gap-2">
          <InlineHint kind="error" className="min-w-0 flex-1">
            {state.error}
          </InlineHint>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => void acquire('auto', kind === 'db_key' ? 'database' : 'image')}
            disabled={acquiring}
          >
            {t('common.retry')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={ScanSearch}
            onClick={() => void acquire('memory_scan', kind === 'db_key' ? 'database' : 'image')}
            disabled={acquiring}
          >
            {t('onboarding.keys.memoryScan')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
