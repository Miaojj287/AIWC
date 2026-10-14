import { WechatCredentialStatusSchema, type AppConfig } from '@aiwc/protocol'
import { invoke } from './hooks'

/** Restore only the previously selected account with validated saved credentials; never scan a process. */
export async function restoreSavedConnection(account: AppConfig['account']): Promise<boolean> {
  const { wxid, dbRoot, cacheDir } = account
  if (!wxid || !dbRoot) return false
  try {
    const credentials = WechatCredentialStatusSchema.parse(await invoke('substrate:credentialStatus', { wxid, dbRoot }))
    if (!credentials.database) return false
    const connected = await invoke('substrate:connect', { wxid, dbRoot, cacheDir: cacheDir || undefined })
    return connected.ok
  } catch {
    // App keeps an actionable connection page when persisted material cannot be restored.
    return false
  }
}
