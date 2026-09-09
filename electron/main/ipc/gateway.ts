import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

export function registerGatewayIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { gateway } = ctx
  handle('gateway:status', () => gateway.status())
  handle('gateway:connect', ({ channel }) => gateway.connect(channel))
  handle('gateway:disconnect', ({ channel }) => gateway.disconnect(channel))
}
