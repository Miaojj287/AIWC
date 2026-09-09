import { useEffect } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
import { cn } from '@/kit'

export interface WindowChromeProps {
  platform: AiwcBridge['platform']
  /** Active tab title; falls back to the product name. */
  title?: string
  /** Electron only: the bar drags the window. Web mode renders the same bar without drag regions. */
  draggable?: boolean
}

export const APP_NAME = 'AIWC'
/** macOS traffic lights sit at x=16 (mainWindow.ts) — keep 80px clear of them. */
const DARWIN_INSET = 80
/** Windows draws min / max / close over the top-right 138px via titleBarOverlay. */
const WIN32_INSET = 140

/**
 * WindowChrome — h48 panel ground + 1px line under it (Figma 115:416). Centred title in the Latin
 * face, 12px Medium. The bar is one drag region; anything interactive inside must add `app-no-drag`.
 */
export function WindowChrome({ platform, title, draggable = true }: WindowChromeProps) {
  const text = title && title.trim() ? title : APP_NAME
  useEffect(() => {
    document.title = text === APP_NAME ? APP_NAME : `${text} — ${APP_NAME}`
  }, [text])
  return (
    <header
      data-testid="window-chrome"
      className={cn('relative flex h-12 shrink-0 select-none items-center border-b border-line-6 bg-panel', draggable && 'app-drag')}
      style={{ paddingLeft: platform === 'darwin' ? DARWIN_INSET : 14, paddingRight: platform === 'win32' ? WIN32_INSET : 14 }}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-24">
        <span className="truncate font-latin text-caption font-medium text-fg" aria-live="polite">
          {text}
        </span>
      </div>
    </header>
  )
}
