import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { bridge } from '@/platform/bridge'

export const APP_NAME = 'AIWC'

const CONTROLS = [
  { action: 'close', labelKey: 'shell.window.close', symbol: '×' },
  { action: 'minimize', labelKey: 'shell.window.minimize', symbol: '−' },
  { action: 'fullscreen', labelKey: 'shell.window.fullscreen', symbol: '+' },
] as const

/** Fixed-size Mac controls without a separate title row. */
export function WindowChrome({ title, showControls = false }: { title?: string; showControls?: boolean }) {
  const t = useT()
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
    <div
      className="mac-window-controls app-no-drag"
      role="group"
      aria-label={t('shell.window.controls')}
      data-focused={focused}
    >
      {CONTROLS.map(({ action, labelKey, symbol }) => (
        <button
          key={action}
          type="button"
          className="mac-window-control"
          data-action={action}
          aria-label={t(labelKey)}
          title={t(labelKey)}
          onClick={() => {
            void bridge()
              .invoke('app:windowControl', { action })
              .catch((e: unknown) => setError(e instanceof Error ? e.message : t('shell.window.actionFailed')))
          }}
        >
          <span aria-hidden="true">{symbol}</span>
        </button>
      ))}
      {error ? (
        <span role="alert" className="absolute left-0 top-6 w-48 rounded-button bg-panel p-2 text-caption text-fg">
          {error}
        </span>
      ) : null}
    </div>
  )
}
