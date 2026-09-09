/**
 * Key widgets for the 账号 page: masked secret field with reveal / copy, manual hex entry, and the
 * 自动获取密钥 progress dialog driven by substrate:acquireKeys + substrate:keyStep (board 151:415 ③).
 */
import { Check, Circle, CircleAlert, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { Button, ICON_STROKE, IconButton, InlineHint, Input, Spinner, cn, toast } from '@/kit'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { DEFAULT_KEY_STEPS, KEY_LABEL, keyStepsToProgress, maskSecret, mergeKeyStep, missingKeyKinds, summarizeKeySteps, validateKeyHex, type KeyKind } from '../accountModel'
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
}

/** Read-only masked key: the eye button reveals via secret:reveal, copy → toast. Mono + tail truncation (CLAUDE.md §6). */
export function SecretField({ kind, secretRef, version = 0, label, className }: SecretFieldProps) {
  const { has } = useSecretPresence(secretRef, version)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRevealed(null), [secretRef, version])

  const reveal = async () => {
    if (revealed !== null) {
      setRevealed(null)
      return
    }
    setBusy(true)
    try {
      const value = await invoke('secret:reveal', { ref: secretRef })
      if (value === null) toast.warning(`${label}尚未设置`)
      else setRevealed(value)
    } catch (e) {
      toast.error(`读取${label}失败`, { detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      const value = revealed ?? (await invoke('secret:reveal', { ref: secretRef }))
      if (value === null) toast.warning(`${label}尚未设置`)
      else await copyText(value, label)
    } catch (e) {
      toast.error('复制失败', { detail: errorMessage(e) })
    }
  }

  const value = revealed ?? (has ? maskSecret(kind) : '')
  return (
    <Input
      mono
      readOnly
      size="sm"
      aria-label={label}
      value={value}
      placeholder={has === undefined ? '读取中…' : '未设置'}
      wrapperClassName={className}
      className="truncate"
      trailing={
        <>
          <IconButton size="xs" icon={revealed !== null ? EyeOff : Eye} label={revealed !== null ? '隐藏' : '显示明文'} disabled={!has} loading={busy} onClick={() => void reveal()} className="text-fg-3" />
          <IconButton size="xs" icon={Copy} label="复制" disabled={!has} onClick={() => void copy()} className="text-fg-3" />
        </>
      }
    />
  )
}

/* ------------------------------------------------------------ ManualKeyForm */

export interface ManualKeyFormProps {
  kind: KeyKind
  onSaved: () => void
  onCancel?: () => void
}

/** Paste a key by hand: 64-hex validation inline, then substrate:setManualKey. */
export function ManualKeyForm({ kind, onSaved, onCancel }: ManualKeyFormProps) {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const check = validateKeyHex(kind, raw)

  const save = async () => {
    if (saving) return
    if (!check.ok) {
      setError(check.error)
      return
    }
    setSaving(true)
    try {
      const res = await invoke('substrate:setManualKey', { kind, hex: check.hex })
      if (!res.ok) {
        setError(res.error ?? '密钥无效')
        return
      }
      toast.success(`${KEY_LABEL[kind]}已保存`)
      setRaw('')
      setError(undefined)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-item border border-line-8 bg-content/60 p-3">
      <div className="text-note text-fg-3">手动输入{KEY_LABEL[kind]}（{kind === 'image_aes' ? '16 字符或 32 位十六进制' : `${kindLength(kind)} 位十六进制`}）</div>
      <div className="flex items-start gap-2">
        <Input
          mono
          size="sm"
          autoFocus
          aria-label={`手动输入${KEY_LABEL[kind]}`}
          value={raw}
          type="password"
          disabled={saving}
          placeholder={kind === 'image_aes' ? '粘贴原项目的 AES 密钥' : '粘贴已有密钥，可带 0x 前缀'}
          onChange={(e) => {
            setRaw(e.target.value)
            setError(undefined)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onCancel?.()
          }}
          error={error ?? (raw.trim() && !check.ok ? true : undefined)}
          wrapperClassName="flex-1"
        />
        {onCancel ? (
          <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="h-7" onClick={() => void save()} loading={saving} disabled={!raw.trim()}>
          保存
        </Button>
      </div>
    </div>
  )
}

const kindLength = (kind: KeyKind) => (kind === 'db_key' ? 64 : kind === 'image_aes' ? 32 : 2)

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

type Phase = { kind: 'running'; strategy: 'auto' | 'memory_scan' } | { kind: 'failed'; error?: string } | { kind: 'done' }

/**
 * Inline key-acquire progress (CLAUDE.md §4.5) — rendered below the key row instead of a modal, the
 * way the reference app does. Live steps ✓/⟳/○/! stream in via substrate:keyStep; a failure keeps the
 * 手动输入 / 内存扫描重试 actions inline. 取消 hides the panel while the main process finishes.
 */
export function InlineKeyAcquire({ wxid, dbRoot, scope, onFinished, onManual, onClose }: InlineKeyAcquireProps) {
  const [steps, setSteps] = useState<KeyAcquireStep[]>(() => DEFAULT_KEY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'doing' : 'todo', detail: undefined })))
  const [phase, setPhase] = useState<Phase>({ kind: 'running', strategy: 'auto' })
  const runRef = useRef(0)

  useBridgeEvent('substrate:keyStep', (step) => setSteps((s) => mergeKeyStep(s, step)))

  const run = async (strategy: 'auto' | 'memory_scan') => {
    const runId = ++runRef.current
    setSteps(DEFAULT_KEY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'doing' : 'todo', detail: undefined })))
    setPhase({ kind: 'running', strategy })
    if (!wxid || !dbRoot) {
      setPhase({ kind: 'failed', error: '请先选择账号与数据库根目录' })
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
        toast.success(scope === 'image' ? '图片密钥已获取' : '密钥已获取并写入本地配置')
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
  useEffect(() => {
    void run('auto')
    return () => {
      runRef.current++
    }
  }, [])

  const summary = summarizeKeySteps(steps)
  const running = phase.kind === 'running'
  const failed = phase.kind === 'failed'
  const missing = failed ? missingKeyKinds(steps) : []
  const active = steps.find((s) => s.status === 'doing')
  const header = failed
    ? scope === 'image' ? '图片密钥获取失败' : '未能自动获取密钥'
    : scope === 'image' ? '正在获取图片密钥…' : running && phase.strategy === 'memory_scan' ? '正在扫描微信进程内存…' : '正在自动获取密钥…'
  const failDetail = failed ? (phase.error ?? summary.failed.map((f) => `${f.label}${f.detail ? `：${f.detail}` : ''}`).join('；')) : undefined

  return (
    <div className={cn('flex flex-col gap-2 rounded-item border p-3', failed ? 'border-danger/40 bg-danger/5' : 'border-line-8 bg-content/60')}>
      <div className="flex items-center gap-2">
        {running ? <Spinner size={13} /> : failed ? <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" /> : <Check size={14} strokeWidth={2} aria-hidden className="text-ok" />}
        <span className={cn('min-w-0 flex-1 truncate text-caption', failed ? 'text-danger' : 'text-fg-2')}>
          {header}
          {running && active?.detail ? ` · ${active.detail}` : ''}
        </span>
        {running ? (
          <Button variant="ghost" size="sm" className="h-7" onClick={onClose}>
            取消
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5 text-tab">
        {keyStepsToProgress(steps).map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center">{STEP_ICON[s.status]}</span>
            <span className={cn('min-w-0 flex-1 truncate', s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg-2')}>{s.label}</span>
            {s.detail ? <span className={cn('shrink-0 truncate text-micro max-w-[55%] text-right', s.status === 'failed' ? 'text-danger' : 'text-fg-3')}>{s.detail}</span> : null}
          </li>
        ))}
      </ol>
      {failed ? (
        <>
          {failDetail ? <InlineHint kind="error">{failDetail}</InlineHint> : null}
          {summary.failed.length > 0 && missing.length === 0 ? <InlineHint kind="warning">密钥已获取，但账号验证未通过：请检查数据库根目录是否属于该 wxid。</InlineHint> : null}
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
                手动输入
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void run('memory_scan')}>
              内存扫描重试
            </Button>
          </div>
        </>
      ) : (
        <span className="text-note text-fg-3">请勿关闭微信；macOS 若提示重新登录，请退出后重新登录微信</span>
      )}
    </div>
  )
}
