import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tailwind.css'
import { ErrorBoundary } from '@/kit'
import { initialLanguage, setLanguage, t } from './i18n'
import { getBridge } from './platform/bridge'
import { setTransparencySupport } from './platform/appearance'
import { App } from './app/App'

async function bootstrap() {
  // Boot screen language until configStore hydrates `general.language`.
  setLanguage(initialLanguage())
  const bridge = await getBridge()
  // One startup handshake: warms version info and gives `electron . --smoke` a reliable signal that
  // the renderer booted with a working IPC bridge, regardless of which screen renders first.
  void bridge
    .invoke('app:getInfo', undefined)
    .then((info) => setTransparencySupport(Boolean(info.transparency)))
    .catch(() => undefined)
  const root = createRoot(document.getElementById('root')!)
  // Backstop for errors outside the per-region boundaries (rail, tab strip, onboarding): React would otherwise
  // unmount the whole tree and leave the window blank. Tabs, list bodies and the Agent panel have their own.
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

void bootstrap().catch((error: unknown) => {
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <div role="alert" className="flex h-screen items-center justify-center bg-content p-8 text-fg-2">
      {error instanceof Error ? error.message : t('app.bootFailed')}
    </div>,
  )
})
