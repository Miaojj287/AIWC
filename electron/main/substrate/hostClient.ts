/**
 * Runs the WeChat substrate in an Electron utility process (native WCDB access is isolated there —
 * if it crashes only that process restarts) and exposes a *stable* SubstrateClient façade to the
 * rest of main. Protocol with electron/hosts/substrateHost.ts:
 *   main → host : SubstrateHostInit + one transferred MessagePort (channel.port2)
 *   host → main : { type: 'ready' } | { type: 'fatal', message } | { type: 'log', level, message }
 * After 'ready' the port carries the substrate JSON-RPC (`createSubstrateClient` on our side).
 */
import { existsSync } from 'node:fs'
import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import type { ConnectionState, SubstrateEvent, SyncStatus } from '@aiwc/protocol'
import { createSubstrateClient, type SourceOpenOptions, type SubstrateClient } from '@aiwc/substrate'
import type { SubstrateHostMessage } from '../../hosts/substrateHost'
import type { Broadcast, SubstrateHost, SubstrateHostInit, SubstrateMode } from '../contracts'
import type { Logger } from '../log'

export interface SubstrateHostDeps {
  /** dist-electron/substrateHost.js */
  entry: string
  logger: Logger
  broadcast: Broadcast
  /** Mode + init payload derived from the current config / secrets. */
  resolveInit: () => SubstrateHostInit
  /** Account to open, or undefined while onboarding is incomplete. */
  resolveOpen: (mode: SubstrateMode) => SourceOpenOptions | undefined
  platform?: NodeJS.Platform
  /** Backoff ceiling for automatic restarts (ms). */
  maxRestartDelayMs?: number
  /** How long to wait for the host's 'ready' before giving up on an open (ms). */
  readyTimeoutMs?: number
}

const IDLE_SYNC: SyncStatus = { phase: 'idle' }

export function restartDelay(attempt: number, maxMs = 30_000): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), maxMs)
}

interface Live {
  proc: UtilityProcess
  port: MessagePortMain
  client: SubstrateClient
  ready: Promise<void>
}

export function createSubstrateHost(deps: SubstrateHostDeps): SubstrateHost {
  const log = deps.logger.child('substrate-host')
  const platform = deps.platform ?? process.platform
  const readyTimeoutMs = deps.readyTimeoutMs ?? 30_000
  const listeners = new Set<(e: SubstrateEvent) => void>()

  let live: Live | undefined
  let mode: SubstrateMode = 'wcdb'
  let stopping = false
  let restartAttempts = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let lastConnection: ConnectionState = 'connecting'

  function emit(e: SubstrateEvent): void {
    if (e.type === 'connection') lastConnection = e.state
    deps.broadcast('substrate:event', e)
    for (const l of listeners) {
      try {
        l(e)
      } catch (err) {
        log.warn('substrate listener threw', err)
      }
    }
  }

  function current(): SubstrateClient {
    if (!live) throw new Error('数据基座尚未就绪，请稍后再试')
    return live.client
  }

  function fork(): Live {
    if (!existsSync(deps.entry)) throw new Error(`substrate host 入口不存在: ${deps.entry}`)
    const init = deps.resolveInit()
    mode = init.mode
    const channel = new MessageChannelMain()
    const proc = utilityProcess.fork(deps.entry, [], {
      serviceName: 'AIWC Substrate',
      stdio: 'pipe',
      allowLoadingUnsignedLibraries: platform === 'darwin',
    })

    let resolveReady: () => void = () => {}
    let rejectReady: (e: Error) => void = () => {}
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    ready.catch(() => {}) // observed by open(); avoid unhandled-rejection noise when nobody awaits

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) log.info(`[host ${proc.pid ?? '?'}] ${text}`)
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) log.warn(`[host ${proc.pid ?? '?'}] ${text}`)
    })
    proc.on('message', (raw: unknown) => {
      const msg = raw as SubstrateHostMessage | undefined
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'ready') {
        log.info('substrate host ready', { pid: proc.pid, mode })
        resolveReady()
      } else if (msg.type === 'fatal') {
        log.error('substrate host fatal', { message: msg.message })
        rejectReady(new Error(msg.message))
      } else if (msg.type === 'log') {
        log[msg.level](`[host] ${msg.message}`)
      }
    })
    proc.on('spawn', () => {
      log.info('substrate host spawned', { pid: proc.pid, mode })
      if (stableTimer) clearTimeout(stableTimer)
      stableTimer = setTimeout(() => {
        restartAttempts = 0
      }, 60_000)
    })
    proc.on('exit', (code) => {
      rejectReady(new Error(`substrate host exited (code ${code})`))
      onExit(proc, code)
    })

    proc.postMessage(init, [channel.port2])

    const client = createSubstrateClient(
      (msg) => channel.port1.postMessage(msg),
      (cb) => {
        channel.port1.on('message', (ev) => cb(ev.data))
      },
    )
    channel.port1.start()
    try {
      client.subscribe(emit)
    } catch (e) {
      log.warn('client.subscribe failed', e)
    }
    const next: Live = { proc, port: channel.port1, client, ready }
    live = next
    return next
  }

  function tearDown(target: Live | undefined, kill: boolean): void {
    if (!target) return
    if (live === target) live = undefined
    try {
      target.client.dispose()
    } catch {
      // ignore
    }
    try {
      target.port.close()
    } catch {
      // ignore
    }
    if (kill) {
      try {
        target.proc.kill()
      } catch {
        // ignore
      }
    }
  }

  function onExit(proc: UtilityProcess, code: number): void {
    if (!live || live.proc !== proc) return // an older process we already replaced
    log.warn('substrate host exited', { code, stopping })
    tearDown(live, false)
    if (stopping) return
    restartAttempts += 1
    const delay = restartDelay(restartAttempts, deps.maxRestartDelayMs)
    emit({ type: 'connection', state: 'error', detail: `数据基座进程退出（code ${code}），${Math.round(delay / 1000)} 秒后重启` })
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      try {
        fork()
        void open()
      } catch (e) {
        log.error('substrate host restart failed', e)
        emit({ type: 'connection', state: 'error', detail: e instanceof Error ? e.message : String(e) })
      }
    }, delay)
  }

  async function awaitReady(target: Live): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`数据基座 ${readyTimeoutMs / 1000} 秒内未就绪`)), readyTimeoutMs)
    })
    try {
      await Promise.race([target.ready, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function open(): Promise<{ ok: boolean; error?: string }> {
    const target = live
    if (!target) return { ok: false, error: '数据基座进程未启动' }
    const opts = deps.resolveOpen(mode)
    if (!opts) {
      log.info('no account configured; substrate stays in no_config')
      emit({ type: 'connection', state: 'no_config' })
      return { ok: false, error: '尚未配置微信账号' }
    }
    try {
      await awaitReady(target)
      await target.client.openWith(opts)
      const status = await target.client.refreshStatus()
      if (status.connection !== 'ready' || status.account?.wxid !== opts.wxid) {
        throw new Error('实际连接账号与所选账号不一致')
      }
      log.info('substrate opened', { mode, wxid: opts.wxid })
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error('substrate open failed', e)
      emit({ type: 'connection', state: 'error', detail: message })
      return { ok: false, error: message }
    }
  }

  async function closeQuietly(target: Live | undefined): Promise<void> {
    if (!target) return
    try {
      await Promise.race([target.client.close(), new Promise((r) => setTimeout(r, 2000))])
    } catch {
      // ignore
    }
  }

  const host: SubstrateHost = {
    mode: () => mode,
    async start() {
      stopping = false
      fork()
      void open()
    },
    async reconnect() {
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      const old = live
      await closeQuietly(old)
      tearDown(old, true)
      try {
        fork()
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        emit({ type: 'connection', state: 'error', detail: message })
        return { ok: false, error: message }
      }
      return open()
    },
    async shutdown() {
      stopping = true
      if (restartTimer) clearTimeout(restartTimer)
      if (stableTimer) clearTimeout(stableTimer)
      const old = live
      await closeQuietly(old)
      tearDown(old, true)
    },

    // ---- SubstrateClient façade (HostedService + SubstrateExtras + client helpers) ----
    openWith: (opts) => current().openWith(opts),
    close: () => current().close(),
    dispose: () => live?.client.dispose(),
    refreshStatus: () => current().refreshStatus(),
    status: () => (live ? live.client.status() : { connection: lastConnection, sync: IDLE_SYNC }),
    listAccounts: () => current().listAccounts(),
    getAccount: () => current().getAccount(),
    listSessions: (q) => current().listSessions(q),
    getSession: (id) => current().getSession(id),
    listMessages: (q) => current().listMessages(q),
    getMessage: (s, m) => current().getMessage(s, m),
    getContext: (a, r) => current().getContext(a, r),
    search: (q) => current().search(q),
    listContacts: (q) => current().listContacts(q),
    getContact: (u) => current().getContact(u),
    listGroupMembers: (g, q) => current().listGroupMembers(g, q),
    stats: (q) => current().stats(q),
    resolveMedia: (s, m) => current().resolveMedia(s, m),
    transcribeVoice: (s, m, o) => {
      const c = current()
      if (!c.transcribeVoice) return Promise.reject(new Error('当前数据基座不支持语音转文字'))
      return c.transcribeVoice(s, m, o)
    },
    sync: (o) => current().sync(o),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    querySql: (req) => {
      const c = current()
      if (!c.querySql) return Promise.reject(new Error('当前数据基座不支持 SQL 查询'))
      return c.querySql(req)
    },
    setSessionFlags: (id, flags) => current().setSessionFlags(id, flags),
    removeIndex: (id) => current().removeIndex(id),
    rebuildIndex: (id) => current().rebuildIndex(id),
  }
  return host
}
