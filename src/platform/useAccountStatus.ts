import { useConfig } from './configStore'
import { useBridgeEvent, useInvoke } from './hooks'

/** Account metadata must refresh after reconnect, not just after a configuration write. */
export function useAccountStatus() {
  const wxid = useConfig((c) => c.account.wxid)
  const dbRoot = useConfig((c) => c.account.dbRoot)
  const status = useInvoke('substrate:status', undefined, [wxid, dbRoot])
  useBridgeEvent('substrate:event', (event) => {
    if (event.type === 'connection' || event.type === 'sessions.changed') status.reload()
  })
  return status
}
