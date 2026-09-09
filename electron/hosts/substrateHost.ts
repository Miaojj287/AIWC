/**
 * Utility-process entry for the WeChat substrate. Native access (WCDB via koffi) and the SQLite
 * mirror live here so a crash only takes this process down. Protocol with the parent:
 *   parent → host : { type: 'init', mode, nativeDir?, fixturePath?, mirrorDbPath, cacheDir } + one transferred MessagePort
 *   host → parent : { type: 'ready' } | { type: 'fatal', message }
 * After init the transferred port carries the substrate JSON-RPC (see packages/substrate/src/host).
 */
import type { MessagePortMain } from 'electron'
import { createMirror, createSubstrateFacade, createWcdbSourceReader, serveSubstrate, type SourceReader } from '@aiwc/substrate'

export interface SubstrateHostInit {
  type: 'init'
  mode: 'wcdb' | 'demo'
  /** resources/native/<platform> (wcdb mode) */
  nativeDir?: string
  /** dev/fixtures/*.json (demo mode) */
  fixturePath?: string
  mirrorDbPath: string
  cacheDir: string
}

export type SubstrateHostMessage = { type: 'ready' } | { type: 'fatal'; message: string } | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }

const parentPort = process.parentPort

function post(msg: SubstrateHostMessage): void {
  try {
    parentPort.postMessage(msg)
  } catch {
    /* parent gone */
  }
}

function fatal(err: unknown): never {
  const message = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ''}` : String(err)
  post({ type: 'fatal', message })
  process.exit(1)
}

process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)

function isInit(v: unknown): v is SubstrateHostInit {
  return typeof v === 'object' && v !== null && (v as { type?: unknown }).type === 'init' && typeof (v as { mirrorDbPath?: unknown }).mirrorDbPath === 'string'
}

function buildSource(init: SubstrateHostInit): SourceReader {
  if (init.mode !== 'wcdb') throw new Error('仅支持读取真实微信数据库')
  if (!init.nativeDir) throw new Error('wcdb 模式缺少 nativeDir')
  return createWcdbSourceReader({ nativeDir: init.nativeDir })
}

let started = false

parentPort.on('message', (event) => {
  const init: unknown = event.data
  if (!isInit(init) || started) return
  started = true
  const port: MessagePortMain | undefined = event.ports[0]
  if (!port) fatal(new Error('init 消息未附带 MessagePort'))
  try {
    const source = buildSource(init)
    const mirror = createMirror({ dbPath: init.mirrorDbPath })
    const facade = createSubstrateFacade({ source, mirror, cacheDir: init.cacheDir })
    const stop = serveSubstrate(facade, port)
    port.on('close', () => {
      stop()
      void facade
        .close()
        .catch(() => {})
        .finally(() => {
          mirror.close()
          process.exit(0)
        })
    })
    port.start()
    post({ type: 'ready' })
  } catch (err) {
    fatal(err)
  }
})
