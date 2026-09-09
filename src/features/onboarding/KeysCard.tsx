/**
 * Card ② 密钥 (Figma 135:415 下半 / 155:415 ②): header 自动获取 → progress dialog; per-key rows with
 * masked value, reveal toggle, manual paste with 64-hex validation; failed rows red with 重试 / 内存扫描.
 */
import { Check, Circle, CircleAlert, Eye, EyeOff, KeyRound, RefreshCw, ScanSearch, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppConfig, KeyAcquireStep } from '@aiwc/protocol'
import { Badge, Button, Card, FieldLabel, ICON_STROKE, IconButton, InlineHint, Input, Spinner, cn, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { KEY_KINDS, KEY_META, hasKey, summariseKeys, type KeyKind, type KeyState } from './gating'
import { useWizardStore } from './wizardStore'

const KEY_REFS: Record<KeyKind, keyof AppConfig['account']> = { db_key: 'dbKeyRef', image_xor: 'imageXorKeyRef', image_aes: 'imageAesKeyRef' }

/** Masked value of an acquired key; 👁 reads the real hex from the secret store (default masked, CLAUDE.md §6). */
function AcquiredKeyInput({ kind, state }: { kind: KeyKind; state: Extract<KeyState, { status: 'acquired' | 'manual' }> }) {
  const ref = useConfig((c) => c.account[KEY_REFS[kind]]) || ({ db_key: 'account:dbKey', image_xor: 'account:imageXorKey', image_aes: 'account:imageAesKey' } as const)[kind]
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
      toast.info('密钥已保存在系统安全存储中，暂无法在此显示')
      return
    }
    setBusy(true)
    try {
      const hex = await invoke('secret:reveal', { ref })
      if (hex) setRevealed(hex)
      else toast.info('系统安全存储中没有这枚密钥')
    } catch (e) {
      toast.error(`读取失败：${e instanceof Error ? e.message : String(e)}`)
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
      aria-label={`${meta.label}（已获取）`}
      wrapperClassName="flex-1"
      trailing={
        <>
          <IconButton size="xs" icon={shown ? EyeOff : Eye} label={shown ? '隐藏' : '显示'} loading={busy} onClick={() => void toggle()} className="text-fg-3" />
          <Badge tone="ok">{state.status === 'acquired' && state.source === 'cached' ? '已缓存' : state.status === 'manual' ? '手动' : '已获取'}</Badge>
        </>
      }
    />
  )
}

function KeyRow({ kind, state, wide = false }: { kind: KeyKind; state: KeyState; wide?: boolean }) {
  const setManualKey = useWizardStore((s) => s.setManualKey)
  const clearKey = useWizardStore((s) => s.clearKey)
  const acquire = useWizardStore((s) => s.acquire)
  const acquiring = useWizardStore((s) => s.acquiring)
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
      <div className={cn('flex items-center gap-3 rounded-item border p-2', failed ? 'border-danger/40 bg-danger/5' : 'border-line-6 bg-content/60')}>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-item', present ? 'bg-ok/15 text-ok' : failed ? 'bg-danger/15 text-danger' : 'bg-accent-15 text-accent')}>
          {present ? <Check size={15} strokeWidth={2} aria-hidden /> : failed ? <CircleAlert size={15} strokeWidth={1.75} aria-hidden /> : <KeyRound size={15} strokeWidth={1.75} aria-hidden />}
        </span>
        <div className="flex w-[124px] shrink-0 flex-col gap-0.5">
          <span className={cn('text-body font-medium', failed ? 'text-danger' : 'text-fg')}>{meta.label}</span>
          <span className="truncate text-micro text-fg-3">{meta.description}</span>
        </div>
        {state.status === 'acquired' || state.status === 'manual' ? (
          <AcquiredKeyInput kind={kind} state={state} />
        ) : (
          <Input
            mono
            type="password"
            value={draft}
            placeholder={kind === 'image_aes' ? '粘贴 16 字符或 32 位十六进制密钥' : `粘贴 ${meta.hexLength} 位十六进制密钥`}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(undefined)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void commit()}
            disabled={saving || acquiring}
            error={Boolean(error)}
            aria-label={meta.label}
            wrapperClassName="flex-1"
          />
        )}
        {!present ? <Button variant="outline" size="sm" loading={saving} disabled={!draft.trim() || acquiring} onClick={() => void commit()}>保存</Button> : null}
        {present ? (
          <Button variant="ghost" size="sm" onClick={() => clearKey(kind)} disabled={acquiring}>
            清除
          </Button>
        ) : null}
      </div>
      {error ? <InlineHint kind="error">{error}</InlineHint> : null}
      {failed ? (
        <div className="flex items-center gap-2">
          <InlineHint kind="error" className="min-w-0 flex-1">
            {state.error}
          </InlineHint>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void acquire('auto')} disabled={acquiring}>
            重试
          </Button>
          <Button variant="outline" size="sm" icon={ScanSearch} onClick={() => void acquire('memory_scan')} disabled={acquiring}>
            内存扫描
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const STEP_ICON: Record<KeyAcquireStep['status'], React.ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  doing: <Spinner size={13} />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

/**
 * Inline key-acquire progress (shown below the key rows, not in a modal). Mirrors the reference app:
 * a compact step list ✓/⟳/○/! with the live detail — including the macOS hook's “请重新登录微信”
 * prompt — plus a 取消 button while running (CLAUDE.md §4.5, long tasks stay cancellable).
 */
function KeyAcquireProgress() {
  const acquiring = useWizardStore((s) => s.acquiring)
  const steps = useWizardStore((s) => s.acquireSteps)
  const strategy = useWizardStore((s) => s.acquireStrategy)
  const cancelAcquire = useWizardStore((s) => s.cancelAcquire)
  if (!acquiring) return null
  const active = steps.find((s) => s.status === 'doing')
  return (
    <div className="flex flex-col gap-2 rounded-item border border-line-6 bg-content/60 p-3">
      <div className="flex items-center gap-2">
        <Spinner size={13} />
        <span className="min-w-0 flex-1 truncate text-caption text-fg-2">
          {strategy === 'memory_scan' ? '正在扫描微信进程内存…' : '正在获取微信数据密钥…'}
          {active?.detail ? ` · ${active.detail}` : ''}
        </span>
        <Button variant="ghost" size="sm" onClick={cancelAcquire}>
          取消
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.id} data-status={s.status} className="flex items-center gap-2 text-tab">
            <span className="flex size-4 shrink-0 items-center justify-center">{STEP_ICON[s.status]}</span>
            <span className={cn('min-w-0 flex-1 truncate', s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg')}>{s.label}</span>
            {s.detail ? <span className={cn('shrink-0 truncate text-micro max-w-[55%] text-right', s.status === 'failed' ? 'text-danger' : 'text-fg-3')}>{s.detail}</span> : null}
          </li>
        ))}
      </ol>
      <span className="text-note text-fg-3">请保持微信处于登录状态；macOS 若提示重新登录，请退出后重新登录微信</span>
    </div>
  )
}

export function KeysCard() {
  const keys = useWizardStore((s) => s.keys)
  const acquiring = useWizardStore((s) => s.acquiring)
  const acquire = useWizardStore((s) => s.acquire)
  const wxid = useWizardStore((s) => s.wxid)
  const dbRoot = useWizardStore((s) => s.dbRoot)
  const summary = summariseKeys(keys)
  const canAcquire = Boolean(wxid && dbRoot) && !acquiring

  const status = acquiring
    ? { kind: 'info' as const, text: '获取中…' }
    : summary.complete
      ? { kind: 'success' as const, text: '已全部获取' }
      : summary.failed.length
        ? { kind: 'error' as const, text: `已获取 ${summary.done} / ${summary.total} 个密钥` }
        : summary.done
          ? { kind: 'warning' as const, text: `已获取 ${summary.done} / ${summary.total} 个密钥` }
          : undefined

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <FieldLabel icon={KeyRound} label="微信数据密钥" help="数据库解密密钥、图片 XOR 密钥、图片 AES 密钥。优先从 kvcomm 缓存读取并用 wxid 验真，失败时回退到内存扫描" hint="三部分一次获取" status={status} className="min-w-0 flex-1" />
        <Button icon={Sparkles} loading={acquiring} onClick={() => void acquire('auto')} disabled={!canAcquire} title={!wxid || !dbRoot ? '请先选择数据库路径与账号' : undefined}>
          {acquiring ? '获取中…' : summary.done > 0 ? '重新获取' : '自动获取'}
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
          <Button variant="ghost" size="sm" icon={ScanSearch} onClick={() => void acquire('memory_scan')} disabled={!canAcquire}>
            自动获取图片密钥
          </Button>
          <span className="text-note text-fg-3">图片密钥缺失时只影响图片预览，可稍后在「设置 › 账号」中获取</span>
        </div>
      ) : null}
    </Card>
  )
}
