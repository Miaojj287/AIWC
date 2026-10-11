import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT, type MessageKey } from '@/i18n'
import type { IconComponent } from '@/kit'
import { bridge } from '@/platform/bridge'
import { useBridgeEvent } from '@/platform/hooks'

export const APP_NAME = 'AIWC'

type WindowAction = 'close' | 'minimize' | 'fullscreen' | 'zoom'

interface ControlSpec {
  id: 'close' | 'minimize' | 'fullscreen'
  labelKey: MessageKey
  icon: IconComponent
}

const CONTROLS: readonly ControlSpec[] = [
  { id: 'close', labelKey: 'shell.window.close', icon: X },
  { id: 'minimize', labelKey: 'shell.window.minimize', icon: Minus },
  { id: 'fullscreen', labelKey: 'shell.window.fullscreen', icon: Maximize2 },
]

/** Glyph size inside the 12px dot and its stroke: the system lights use a heavy 8px mark. */
const GLYPH_SIZE = 8
const GLYPH_STROKE = 3

/**
 * Fixed-size Mac controls without a separate title row. They follow the native rules the system lights follow:
 * grey while the window is inactive, glyphs on hover, ⌥ turns the green light into zoom (maximise / restore), hidden
 * in native full screen, and never a Tab stop (⌘W / ⌘M / ⌃⌘F cover the keyboard). Also keeps `document.title` in
 * step with the active tab for Mission Control and the Window menu.
 */
export function WindowChrome({
  title,
  showControls = false,
  showTitleBar = false,
}: {
  title?: string
  showControls?: boolean
  /** Windows reserves a full-width band for native caption buttons, above every column. */
  showTitleBar?: boolean
}) {
  const t = useT()
  const text = title?.trim() || APP_NAME
  const [focused, setFocused] = useState(() => document.hasFocus())
  const [alt, setAlt] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    document.title = text === APP_NAME ? APP_NAME : `${text} — ${APP_NAME}`
  }, [text])
  useEffect(() => {
    const focus = () => setFocused(true)
    const blur = () => {
      setFocused(false)
      setAlt(false)
    }
    const key = (event: KeyboardEvent) => setAlt(event.altKey)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
    }
  }, [])
  // The columns make room for the lights through CSS keyed on <html data-fullscreen> (shell.css).
  useBridgeEvent('app:windowState', (state) => setFullscreen(state.fullscreen))
  useEffect(() => {
    if (fullscreen) document.documentElement.dataset.fullscreen = 'true'
    else delete document.documentElement.dataset.fullscreen
    return () => {
      delete document.documentElement.dataset.fullscreen
    }
  }, [fullscreen])
  if (fullscreen) return null
  if (showTitleBar) return <div className="shell-titlebar app-drag shrink-0" aria-hidden />
  if (!showControls) return null
  return (
    <div
      className="mac-window-controls app-no-drag"
      role="group"
      aria-label={t('shell.window.controls')}
      data-focused={focused}
    >
      {CONTROLS.map(({ id, labelKey, icon }) => {
        const zoom = id === 'fullscreen' && alt
        const action: WindowAction = zoom ? 'zoom' : id
        const label = zoom ? t('shell.window.zoom') : t(labelKey)
        const Glyph = zoom ? Plus : icon
        return (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            className="mac-window-control"
            data-action={id}
            aria-label={label}
            title={label}
            onClick={(event) => {
              const next: WindowAction = id === 'fullscreen' && event.altKey ? 'zoom' : action
              void bridge()
                .invoke('app:windowControl', { action: next })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : t('shell.window.actionFailed')))
            }}
          >
            <Glyph size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden />
          </button>
        )
      })}
      {error ? (
        <span role="alert" className="absolute left-0 top-6 w-48 rounded-control bg-panel p-2 text-caption text-fg">
          {error}
        </span>
      ) : null}
    </div>
  )
}
