/**
 * Key widgets for the 账号 page: masked secret field with reveal / copy, manual hex entry, and the
 * inline 自动获取密钥 progress driven by substrate:acquireKeys + substrate:keyStep (board 151:415 ③).
 */
import { Copy, Eye, EyeOff, RefreshCw, Settings, type LucideIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import type { KeyAcquireScope, KeyAcquireStep } from '@aiwc/protocol'
import { Button, IconButton, Input, TaskProgress, toast } from '@/kit'
import { useT } from '@/i18n'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import {
  DEVELOPER_TOOLS_SETTINGS_URL,
  closeKeySteps,
  initialKeySteps,
  keyAcquireView,
  mergeKeyStep,
  useClock,
} from '@/platform/wechatKeys'
import { KEY_LABEL, maskSecret, missingKeyKinds, validateKeyHex, type KeyKind } from '../accountModel'
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

/**
 * 自动获取 trigger. Accent only while its key is still missing; once present, re-acquiring is a
 * secondary action (no stray accent on a page the user revisits).
 */
export function AcquireKeysButton({
  secretRef,
  version,
  available,
  icon,
  disabled,
  disabledReason,
  onClick,
  children,
}: {
  secretRef: string
  version: number
  available?: boolean
  icon: LucideIcon
  disabled?: boolean
  disabledReason?: string
  onClick: () => void
  children: ReactNode
}) {
  const { has } = useSecretPresence(secretRef, version)
  return (
    <Button
      variant={(available ?? has) ? 'outline' : 'primary'}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      disabledReason={disabledReason}
    >
      {children}
    </Button>
  )
}

export interface InlineKeyAcquireProps {
  wxid: string | undefined
  dbRoot: string | undefined
  /** Database connection and optional image recovery run independently. */
  scope: KeyAcquireScope
  /** Called after a run that acquired at least one key (config may have changed). */
  onFinished: (steps: KeyAcquireStep[]) => void
  /** The user chose 手动输入 for a key that could not be acquired. */
  onManual: (kind: KeyKind) => void
  /** Dismiss the inline panel (取消 / 关闭). */
  onClose: () => void
}

/**
 * Inline key-acquire progress (CLAUDE.md §4.5) below the key row — the same kit `TaskProgress` and
 * stage copy as the onboarding keys card (src/platform/wechatKeys.ts). 取消 aborts the main-process
 * run; a failure stays with its reason and 重试 / 手动输入. Success closes the panel (main toasts).
 */
export function InlineKeyAcquire({ wxid, dbRoot, scope, onFinished, onManual, onClose }: InlineKeyAcquireProps) {
  const t = useT()
  const [steps, setSteps] = useState<KeyAcquireStep[]>(() => initialKeySteps(scope))
  const [running, setRunning] = useState(true)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const runRef = useRef(0)
  const runningRef = useRef(true)
  const now = useClock(running)

  useBridgeEvent('substrate:keyStep', (step) => {
    if (runningRef.current) setSteps((s) => mergeKeyStep(s, step))
  })

  const settle = (next: KeyAcquireStep[]) => {
    runningRef.current = false
    setRunning(false)
    setSteps(next)
  }

  const run = async () => {
    const runId = ++runRef.current
    runningRef.current = true
    setRunning(true)
    setStartedAt(Date.now())
    setSteps(initialKeySteps(scope))
    if (!wxid || !dbRoot) {
      settle(closeKeySteps(initialKeySteps(scope), 'unexpected', t('settings.account.acquire.selectFirst'), scope))
      return
    }
    try {
      const result = await invoke('substrate:acquireKeys', { wxid, dbRoot, strategy: 'auto', scope })
      if (runRef.current !== runId) return
      settle(result)
      if (result.some((s) => s.status === 'done')) onFinished(result)
      if (keyAcquireView(result, { running: false, now: Date.now() }).state === 'done') onClose()
    } catch (e) {
      if (runRef.current !== runId) return
      setSteps((prev) => closeKeySteps(prev, 'unexpected', errorMessage(e), scope))
      runningRef.current = false
      setRunning(false)
    }
  }

  const cancel = () => {
    runRef.current++
    runningRef.current = false
    // The panel closes even if IPC is unavailable; the utility process also bounds its own run.
    void invoke('substrate:cancelAcquireKeys', undefined).catch(() => undefined)
    onClose()
  }

  // Kick off once on mount; the ref guards stale completions after 取消 / re-run.
  const startOnMount = useEffectEvent(() => {
    void run()
  })
  useEffect(() => {
    startOnMount()
    return () => {
      // `runRef` is a run counter, not a DOM node: bumping it on unmount drops the pending completion.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runRef.current++
      if (runningRef.current) {
        runningRef.current = false
        void invoke('substrate:cancelAcquireKeys', undefined).catch(() => {
          // The old panel is gone; the utility process also bounds its own operation.
        })
      }
    }
  }, [])

  const view = keyAcquireView(steps, { running, startedAt, now })
  const missing = view.state === 'failed' ? missingKeyKinds(steps) : []
  const manualKind = missing[0]

  return (
    <TaskProgress
      {...view}
      onCancel={cancel}
      actions={
        view.state === 'failed' ? (
          <>
            <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => void run()}>
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
            ) : null}
            {manualKind ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onManual(manualKind)
                  onClose()
                }}
              >
                {t('settings.account.acquire.manual')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        ) : undefined
      }
    />
  )
}
