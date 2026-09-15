/**
 * Key widgets for the 账号 page: masked secret field with reveal / copy, manual hex entry, and the
 * 自动获取密钥 progress dialog driven by substrate:acquireKeys + substrate:keyStep (board 151:415 ③).
 */
import { Check, Circle, CircleAlert, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { Button, ICON_STROKE, IconButton, InlineHint, Input, Spinner, cn, toast } from '@/kit'
import { useT } from '@/i18n'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import {
  DEFAULT_KEY_STEPS,
  KEY_LABEL,
  keyStepsToProgress,
  maskSecret,
  mergeKeyStep,
  missingKeyKinds,
  summarizeKeySteps,
  validateKeyHex,
  type KeyKind,
} from '../accountModel'
import { copyText, errorMessage, useSecretPresence } from '../hooks'

/* ------------------------------------------------------------- SecretField */

export interface SecretFieldProps {
  kind: KeyKind
  /** Secret-store reference. */
  secretRef: string
  /** Bump to re-check presence after the main process stored a key. */
  version?: number
  label: string
  className?: string
  onSaved?: () => void
}

/** Editable secret; validate and persist on Enter / blur, Escape discards the draft. */
export function SecretField({ kind, secretRef, version = 0, label, className, onSaved }: SecretFieldProps) {
  const t = useT()
  const { has, reload } = useSecretPresence(secretRef, version)
  const [draft, setDraft] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    setDraft(null)
    setRevealed(null)
    setVisible(false)
    setError(undefined)
    return () => {
      // `epoch` is a counter, not a DOM node: bumping it on cleanup makes in-flight saves for the old secret stale.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++
    }
  }, [secretRef, version])

  const save = async () => {
    if (draft === null || savingRef.current) return
    const check = validateKeyHex(kind, draft)
    if (!check.ok) {
      setError(check.error)
      return
    }
    savingRef.current = true
    setSaving(true)
    const request = epoch.current
    try {
      const result = await invoke('substrate:setManualKey', { kind, hex: check.hex })
      if (request !== epoch.current) return
      if (!result.ok) {
        setError(result.error ?? t('settings.account.secret.invalid'))
        return
      }
      setDraft(null)
      setRevealed(null)
      setVisible(false)
      setError(undefined)
      reload()
      onSaved?.()
      toast.success(t('settings.account.secret.saved', { label: t(KEY_LABEL[kind]) }))
    } catch (e) {
      if (request === epoch.current) setError(errorMessage(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const reveal = async () => {
    if (visible) {
      setVisible(false)
      return
    }
    if (draft !== null) {
      setVisible(true)
      return
    }
    const request = epoch.current
    try {
      const value = await invoke('secret:reveal', { ref: secretRef })
      if (request !== epoch.current) return
      if (value !== null) {
        setRevealed(value)
        setVisible(true)
      }
    } catch (e) {
      toast.error(t('settings.account.secret.readFailed', { label }), { detail: errorMessage(e) })
    }
  }
  const copy = async () => {
    try {
      const value = draft ?? revealed ?? (await invoke('secret:reveal', { ref: secretRef }))
      if (value !== null) await copyText(value, label)
    } catch (e) {
      toast.error(t('common.copyFailed'), { detail: errorMessage(e) })
    }
  }
  return (
    <Input
      id={`account-key-${kind}`}
      mono
      size="sm"
      type={visible ? 'text' : 'password'}
      revealable={false}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      readOnly={saving}
      value={draft ?? revealed ?? (has ? maskSecret(kind) : '')}
      onFocus={(e) => {
        if (draft === null) e.target.select()
      }}
      onChange={(e) => {
        setDraft(e.target.value.replace(/•/g, ''))
        setError(undefined)
      }}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void save()
        }
        if (e.key === 'Escape') {
          setDraft(null)
          setRevealed(null)
          setVisible(false)
          setError(undefined)
        }
      }}
      placeholder={has === undefined ? t('settings.account.loading') : t('settings.account.secret.placeholder')}
      error={error}
      wrapperClassName={className}
      trailing={
        <>
          <IconButton
            size="xs"
            icon={visible ? EyeOff : Eye}
            label={visible ? t('settings.account.secret.hide') : t('settings.account.secret.reveal')}
            disabled={saving || (!has && draft === null)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void reveal()}
          />
          <IconButton
            size="xs"
            icon={Copy}
            label={t('common.copy')}
            disabled={saving || (!has && draft === null)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void copy()}
          />
        </>
      }
    />
  )
}

/* --------------------------------------------------------- InlineKeyAcquire */

export interface InlineKeyAcquireProps {
  wxid: string | undefined
  dbRoot: string | undefined
  /** 'all' = 数据库 + 图片密钥 (账号页); 'image' = only the image keys are of interest (copy differs). */
  scope: 'all' | 'image'
  /** Called after a run that acquired at least one key (config may have changed). */
  onFinished: (steps: KeyAcquireStep[]) => void
  /** The user chose 手动输入 for a key that could not be acquired. */
  onManual: (kind: KeyKind) => void
  /** Dismiss the inline panel (取消 / 关闭). */
  onClose: () => void
}

const STEP_ICON: Record<KeyAcquireStep['status'], React.ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  doing: <Spinner size={13} />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

type Phase =
  { kind: 'running'; strategy: 'auto' | 'memory_scan' } | { kind: 'failed'; error?: string } | { kind: 'done' }

/**
 * Inline key-acquire progress (CLAUDE.md §4.5) — rendered below the key row instead of a modal, the
 * way the reference app does. Live steps ✓/⟳/○/! stream in via substrate:keyStep; a failure keeps the
 * 手动输入 / 内存扫描重试 actions inline. 取消 hides the panel while the main process finishes.
 */
export function InlineKeyAcquire({ wxid, dbRoot, scope, onFinished, onManual, onClose }: InlineKeyAcquireProps) {
  const t = useT()
  const [steps, setSteps] = useState<KeyAcquireStep[]>(() =>
    DEFAULT_KEY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'doing' : 'todo', detail: undefined })),
  )
  const [phase, setPhase] = useState<Phase>({ kind: 'running', strategy: 'auto' })
  const runRef = useRef(0)

  useBridgeEvent('substrate:keyStep', (step) => setSteps((s) => mergeKeyStep(s, step)))

  const run = async (strategy: 'auto' | 'memory_scan') => {
    const runId = ++runRef.current
    setSteps(DEFAULT_KEY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'doing' : 'todo', detail: undefined })))
    setPhase({ kind: 'running', strategy })
    if (!wxid || !dbRoot) {
      setPhase({ kind: 'failed', error: t('settings.account.acquire.selectFirst') })
      return
    }
    try {
      const result = await invoke('substrate:acquireKeys', { wxid, dbRoot, strategy })
      if (runRef.current !== runId) return
      setSteps(result)
      const summary = summarizeKeySteps(result)
      if (summary.failed.length > 0) {
        setPhase({ kind: 'failed' })
      } else {
        setPhase({ kind: 'done' })
        toast.success(scope === 'image' ? t('settings.account.acquire.imageDone') : t('settings.account.acquire.done'))
        onFinished(result)
        onClose()
      }
      if (summary.done > 0) onFinished(result)
    } catch (e) {
      if (runRef.current !== runId) return
      setPhase({ kind: 'failed', error: errorMessage(e) })
    }
  }

  // Kick off once on mount; the ref guards stale completions after 取消 / re-run.
  const startOnMount = useEffectEvent(() => {
    void run('auto')
  })
  useEffect(() => {
    startOnMount()
    return () => {
      // `runRef` is a run counter, not a DOM node: bumping it on unmount drops the pending completion.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runRef.current++
    }
  }, [])

  const summary = summarizeKeySteps(steps)
  const running = phase.kind === 'running'
  const failed = phase.kind === 'failed'
  const missing = failed ? missingKeyKinds(steps) : []
  const active = steps.find((s) => s.status === 'doing')
  const header = failed
    ? scope === 'image'
      ? t('settings.account.acquire.imageFailed')
      : t('settings.account.acquire.failed')
    : scope === 'image'
      ? t('settings.account.acquire.imageRunning')
      : running && phase.strategy === 'memory_scan'
        ? t('settings.account.acquire.scanning')
        : t('settings.account.acquire.running')
  const failDetail = failed
    ? (phase.error ??
      summary.failed
        .map((f) =>
          f.detail ? t('settings.account.acquire.stepDetail', { label: f.label, detail: f.detail }) : f.label,
        )
        .join(t('settings.account.acquire.detailSeparator')))
    : undefined

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-item border p-3',
        failed ? 'border-danger/40 bg-danger/5' : 'border-line-8 bg-content/60',
      )}
    >
      <div className="flex items-center gap-2">
        {running ? (
          <Spinner size={13} />
        ) : failed ? (
          <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />
        ) : (
          <Check size={14} strokeWidth={2} aria-hidden className="text-ok" />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-caption', failed ? 'text-danger' : 'text-fg-2')}>
          {header}
          {running && active?.detail ? ` · ${active.detail}` : ''}
        </span>
        {running ? (
          <Button variant="ghost" size="sm" className="h-7" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5 text-tab">
        {keyStepsToProgress(steps).map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center">{STEP_ICON[s.status]}</span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg-2',
              )}
            >
              {s.label}
            </span>
            {s.detail ? (
              <span
                className={cn(
                  'shrink-0 truncate text-micro max-w-[55%] text-right',
                  s.status === 'failed' ? 'text-danger' : 'text-fg-3',
                )}
              >
                {s.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {failed ? (
        <>
          {failDetail ? <InlineHint kind="error">{failDetail}</InlineHint> : null}
          {summary.failed.length > 0 && missing.length === 0 ? (
            <InlineHint kind="warning">{t('settings.account.acquire.verifyFailed')}</InlineHint>
          ) : null}
          <div className="flex items-center gap-2">
            {missing[0] ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onManual(missing[0] as KeyKind)
                  onClose()
                }}
              >
                {t('settings.account.acquire.manual')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('common.close')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void run('memory_scan')}>
              {t('settings.account.acquire.memoryScan')}
            </Button>
          </div>
        </>
      ) : (
        <span className="text-note text-fg-3">{t('settings.account.acquire.keepLoggedIn')}</span>
      )}
    </div>
  )
}
