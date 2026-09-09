import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tailwind.css'
import { getBridge } from './platform/bridge'
import { App } from './app/App'

async function bootstrap() {
  const bridge = await getBridge()
  // One startup handshake: warms version info and gives `electron . --smoke` a reliable signal that
  // the renderer booted with a working IPC bridge, regardless of which screen renders first.
  void bridge.invoke('app:getInfo', undefined).catch(() => undefined)
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap().catch((error: unknown) => {
  const root = createRoot(document.getElementById('root')!)
  root.render(<div role="alert" className="flex h-screen items-center justify-center bg-content p-8 text-fg-2">{error instanceof Error ? error.message : '本地数据服务不可用'}</div>)
})
