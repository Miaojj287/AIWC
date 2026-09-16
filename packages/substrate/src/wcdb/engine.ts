/**
 * Chooses the database engine for one account: the native WCDB bridge when `resources/native` carries
 * a build for this platform (macOS does), otherwise the pure-TypeScript SQLCipher engine (Windows).
 * `AIWC_WCDB_ENGINE=wcdb|sqlcipher` pins one, which is how the fallback gets exercised on macOS.
 */
import type { WcdbBridge, WcdbLogger } from './bridge'
import { findWcdbLibrary, resolveWcdbLibrary } from './nativeLib'
import { OpenWcdbBridge } from './openWcdbBridge'
import { SqlcipherBridge } from './sqlcipherBridge'

export type WcdbEngine = 'wcdb' | 'sqlcipher'

export interface WcdbBridgeOptions {
  /** resources/native root for this platform. */
  nativeDir: string
  /** Where the SQLCipher engine keeps decrypted copies. */
  cacheDir: string
  logger?: WcdbLogger
}

function requestedEngine(): WcdbEngine | 'auto' {
  const value = String(process.env.AIWC_WCDB_ENGINE || '')
    .trim()
    .toLowerCase()
  return value === 'wcdb' || value === 'sqlcipher' ? value : 'auto'
}

export function createWcdbBridge(opts: WcdbBridgeOptions): { bridge: WcdbBridge; engine: WcdbEngine } {
  const requested = requestedEngine()
  if (requested !== 'sqlcipher') {
    // `resolveWcdbLibrary` throws NativeMissingError, which is the right answer only when the caller
    // explicitly asked for the native engine.
    const library = requested === 'wcdb' ? resolveWcdbLibrary(opts.nativeDir) : findWcdbLibrary(opts.nativeDir)
    if (library) {
      const bridge = new OpenWcdbBridge()
      const init = bridge.initialize(library)
      if (init.success) return { bridge, engine: 'wcdb' }
      bridge.dispose()
      if (requested === 'wcdb') throw new Error(init.error || 'WCDB 初始化失败')
      opts.logger?.('warn', '[wcdb] native WCDB unusable, using the SQLCipher engine', init.error)
    }
  }
  return { bridge: new SqlcipherBridge({ cacheDir: opts.cacheDir, logger: opts.logger }), engine: 'sqlcipher' }
}
