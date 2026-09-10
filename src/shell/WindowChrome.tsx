import { useEffect, useState } from 'react'
import { bridge } from '@/platform/bridge'

export const APP_NAME = 'AIWC'

const CONTROLS = [
  { action: 'close', label: '关闭窗口', symbol: '×' },
  { action: 'minimize', label: '最小化窗口', symbol: '−' },
  { action: 'fullscreen', label: '切换全屏', symbol: '+' },
] as const

/** Fixed-size Mac controls without a separate title row. */
export function WindowChrome({ title, showControls = false }: { title?: string; showControls?: boolean }) {
  const text = title?.trim() || APP_NAME
  const [focused, setFocused] = useState(() => document.hasFocus())
  const [error, setError] = useState('')
  useEffect(() => {
    document.title = text === APP_NAME ? APP_NAME : `${text} — ${APP_NAME}`
  }, [text])
  useEffect(() => {
    const focus = () => setFocused(true)
    const blur = () => setFocused(false)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }, [])
  if (!showControls) return null
  return (
    <div className="mac-window-controls app-no-drag" role="group" aria-label="窗口控制" data-focused={focused}>
      {CONTROLS.map(({ action, label, symbol }) => (
        <button key={action} type="button" className="mac-window-control" data-action={action} aria-label={label} title={label}
          onClick={() => { void bridge().invoke('app:windowControl', { action }).catch((e: unknown) => setError(e instanceof Error ? e.message : '窗口操作失败')) }}>
          <span aria-hidden="true">{symbol}</span>
        </button>
      ))}
      {error ? <span role="alert" className="absolute left-0 top-6 w-48 rounded-button bg-panel p-2 text-caption text-fg">{error}</span> : null}
    </div>
  )
}
