/**
 * Preload: exposes the typed bridge. No business logic here — just a safe, allow-listed pipe.
 *
 * Runs sandboxed (contextIsolation on, nodeIntegration off), so Electron evaluates the built file as a
 * plain CommonJS script: it must be emitted as `dist-electron/preload.cjs` in **cjs** format (the
 * vite.config.ts preload entry passes `rollupOptions.output` as an array so Vite keeps that format).
 * An ES-module build fails with "Cannot use import statement outside a module", `window.aiwc` is
 * never exposed, and the renderer silently falls back to its mock bridge — main logs the reason via
 * the `preload-error` event (windows/preloadDiagnostics.ts).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type AiwcBridge } from '@aiwc/protocol'

const invokeSet = new Set<string>(INVOKE_CHANNELS)
const eventSet = new Set<string>(EVENT_CHANNELS)

/**
 * Electron wraps every rejection from ipcMain.handle as
 * `Error invoking remote method 'chan': Error: <real message>`. That prefix ends up verbatim in the
 * UI's error toasts and inline hints, where it is noise the user cannot act on (交互准则 6 / 14 / 15).
 * Strip it so the renderer only ever sees the message main actually threw.
 */
function unwrapIpcError(channel: string, e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  const prefix = `Error invoking remote method '${channel}': `
  let msg = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  msg = msg.replace(/^(?:[A-Za-z]*Error): /, '')
  const err = new Error(msg.trim() || '操作失败，请重试')
  if (e instanceof Error && e.stack) err.stack = e.stack
  return err
}

const bridge: AiwcBridge = {
  runtime: 'electron',
  platform: process.platform as AiwcBridge['platform'],
  invoke(channel, req) {
    if (!invokeSet.has(channel)) return Promise.reject(new Error(`unknown ipc channel: ${channel}`))
    return ipcRenderer.invoke(channel, req).catch((e: unknown) => {
      throw unwrapIpcError(channel, e)
    })
  },
  on(channel, listener) {
    if (!eventSet.has(channel)) throw new Error(`unknown event channel: ${channel}`)
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('aiwc', bridge)
