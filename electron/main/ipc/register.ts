/**
 * IPC registration. `handle()` is the single typed funnel over ipcMain.handle: it checks the sender
 * is one of our windows, logs failures and normalises thrown values to Error. Every InvokeMap
 * channel must be registered — `registerIpc` verifies coverage and logs what is missing.
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { INVOKE_CHANNELS, type InvokeChannel, type InvokeReq, type InvokeRes } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { registerAppIpc } from './app'
import { registerConfigIpc } from './config'
import { registerAiIpc } from './ai'
import { registerSubstrateIpc } from './substrate'
import { registerAgentIpc } from './agent'
import { registerMemoryIpc } from './memory'
import { registerCloneIpc } from './clone'
import { registerAutoReplyIpc } from './autoreply'
import { registerGatewayIpc } from './gateway'
import { registerDiaryIpc } from './diary'
import { registerFileIpc } from './file'

/** What the IPC layer needs from the Electron host (index.ts) beyond the composed AppContext. */
export interface HostBridge {
  appVersion: string
  isPackaged: boolean
  getMainWindow(): BrowserWindow | undefined
  isTrustedSender(sender: WebContents): boolean
  hideMainWindow(): void
  quit(): void
  /** Fired when the renderer calls app:getInfo — the --smoke run waits for this. */
  onGetInfo?: () => void
}

export type Handler<K extends InvokeChannel> = (req: InvokeReq<K>, event: IpcMainInvokeEvent) => Promise<InvokeRes<K>> | InvokeRes<K>

export interface Handle {
  <K extends InvokeChannel>(channel: K, fn: Handler<K>): void
}

const SLOW_MS = 2000

export function createHandle(ctx: AppContext, host: HostBridge, registered: Set<string>): Handle {
  const log = ctx.logger.child('ipc')
  return function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>): void {
    if (registered.has(channel)) {
      ipcMain.removeHandler(channel)
      log.warn(`duplicate handler for ${channel}, replacing`)
    }
    registered.add(channel)
    ipcMain.handle(channel, async (event, req: unknown) => {
      if (!host.isTrustedSender(event.sender)) {
        log.warn(`rejected ${channel} from untrusted sender`, { id: event.sender.id })
        throw new Error('拒绝来自未知窗口的请求')
      }
      const started = Date.now()
      try {
        return await fn(req as InvokeReq<K>, event)
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        log.warn(`${channel} failed: ${err.message}`)
        throw err
      } finally {
        const ms = Date.now() - started
        if (ms > SLOW_MS) log.debug(`${channel} took ${ms}ms`)
      }
    })
  }
}

export function registerIpc(ctx: AppContext, host: HostBridge): void {
  const registered = new Set<string>()
  const handle = createHandle(ctx, host, registered)
  registerAppIpc(ctx, host, handle)
  registerConfigIpc(ctx, host, handle)
  registerAiIpc(ctx, host, handle)
  registerSubstrateIpc(ctx, host, handle)
  registerAgentIpc(ctx, host, handle)
  registerMemoryIpc(ctx, host, handle)
  registerCloneIpc(ctx, host, handle)
  registerAutoReplyIpc(ctx, host, handle)
  registerGatewayIpc(ctx, host, handle)
  registerDiaryIpc(ctx, host, handle)
  registerFileIpc(ctx, host, handle)

  const missing = INVOKE_CHANNELS.filter((c) => !registered.has(c))
  if (missing.length) ctx.logger.child('ipc').error('InvokeMap channels without handler', missing)
  else ctx.logger.child('ipc').info(`registered ${registered.size} ipc channels`)
}

/** Throws the message the renderer shows inline; used by every handler for user-facing failures. */
export function userError(message: string): never {
  throw new Error(message)
}
