/**
 * The office service: one object the composition root owns and both the agent tools and the IPC
 * handlers use. It finds (or installs) each vendor CLI, runs connect flows as observable sessions —
 * links validated, QR-encoded and opened in the browser, steps published as they change — pushes
 * tables, keeps the push history, and runs policy-checked CLI calls for the generic tools.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  OFFICE_PLATFORMS,
  isOfficeHostUrl,
  type OfficeConnectSession,
  type OfficeConnectStep,
  type OfficePlatform,
  type OfficePlatformStatus,
  type OfficePushRecord,
} from '@aiwc/protocol'
import { createCliEnv, killAllCliProcesses, type CliEnv, type NodeRuntime, type SegmentClassifier } from '@aiwc/shell'
import { createCliRunner, OfficeError, parseVersion, type CliRunner } from './cli/runner'
import { createPushHistory, type PushHistory } from './history'
import { hostMatches } from './platforms/common'
import { dingtalk } from './platforms/dingtalk'
import { feishu } from './platforms/feishu'
import type { AppendTarget, ConnectHooks, PlatformModule, PlatformSpec, PushContext } from './platforms/types'
import { wecom } from './platforms/wecom'
import { normalizeTable, TableValidationError, type TableInput } from './push/table'

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface OfficeServiceDeps {
  /** App-private directory: CLI install prefix, push history, CLI working files. */
  dataDir: string
  /** Hands a validated https URL to the default browser. */
  openExternal(url: string): Promise<void>
  env?: NodeJS.ProcessEnv
  /** Runs npm JS shims when `node` is not on PATH (Electron with ELECTRON_RUN_AS_NODE=1). */
  fallbackNode?: NodeRuntime
  renderQr?(text: string): Promise<string>
  logger?: Log
  now?: () => number
  /** Tests: swap platform modules or the CLI environment. */
  modules?: Partial<Record<OfficePlatform, PlatformModule>>
  cliEnv?: CliEnv
}

export interface ConnectRequest {
  platform: OfficePlatform
  reauthorize?: boolean
  domains?: string[]
  /** Agent tool call that asked for it (its row renders the session). */
  callId?: string
}

export interface PushTableRequest extends TableInput {
  platform: OfficePlatform
  target?: { url?: string; pushId?: string }
}

export interface PushTableResult {
  record: OfficePushRecord
  warnings: string[]
}



export interface OfficeService {
  spec(platform: OfficePlatform): PlatformSpec
  status(opts?: { refresh?: boolean; platforms?: readonly OfficePlatform[] }): Promise<OfficePlatformStatus[]>
  connect(req: ConnectRequest): { session: OfficeConnectSession; done: Promise<OfficeConnectSession> }
  cancel(sessionId: string): boolean
  /** Re-open a waiting session's link in the browser. */
  openLink(sessionId: string): Promise<boolean>
  sessions(): OfficeConnectSession[]
  disconnect(platform: OfficePlatform): Promise<OfficePlatformStatus>
  pushTable(
    req: PushTableRequest,
    ctx: { signal: AbortSignal; progress(message: string, fraction?: number): void },
  ): Promise<PushTableResult>
  recentPushes(limit?: number): Promise<OfficePushRecord[]>
  /**
   * Grades a vendor-CLI command line for the `shell` tool: known read verbs run silently, writes ask,
   * credential / delete / daemon commands are destructive. Returns undefined for other programs.
   */
  commandClassifier(): SegmentClassifier
  /** Directories the CLIs keep their tokens and caches in — writable inside the shell sandbox. */
  writableRoots(): string[]
  onSession(listener: (session: OfficeConnectSession) => void): () => void
  shutdown(): void
}

const STATUS_TTL_MS = 60_000
const KEEP_FINISHED_SESSIONS = 20

interface Located {
  cli: CliRunner
  version?: string
}

interface SessionRuntime {
  session: OfficeConnectSession
  controller: AbortController
  done: Promise<OfficeConnectSession>
}

export function createOfficeService(deps: OfficeServiceDeps): OfficeService {
  const log: Log = deps.logger ?? (() => {})
  const now = deps.now ?? Date.now
  const modules: Record<OfficePlatform, PlatformModule> = { feishu, dingtalk, wecom, ...deps.modules }
  const installDir = join(deps.dataDir, 'cli')
  const installHome = join(installDir, 'home')
  const history: PushHistory = createPushHistory(join(deps.dataDir, 'pushes.jsonl'))
  const renderQr = deps.renderQr ?? defaultRenderQr

  let cliEnv: Promise<CliEnv> | undefined
  const env = () =>
    (cliEnv ??= deps.cliEnv
      ? Promise.resolve(deps.cliEnv)
      : createCliEnv({ env: deps.env, preferredDirs: [join(installDir, 'node_modules', '.bin')] }))

  const located = new Map<OfficePlatform, Promise<Located | undefined>>()
  const locate = (platform: OfficePlatform, fresh = false): Promise<Located | undefined> => {
    if (!fresh && located.has(platform)) return located.get(platform) as Promise<Located | undefined>
    const job = (async () => {
      const e = await env()
      const path = await e.which(modules[platform].spec.bin)
      if (!path) return undefined
      const cli = await createCliRunner(modules[platform].spec.bin, path, e, deps.fallbackNode)
      const v = await cli.run(['--version'], { timeoutMs: 15_000 }).catch(() => undefined)
      return { cli, version: v ? parseVersion(`${v.stdout} ${v.stderr}`) : undefined }
    })().catch((err) => {
      log('warn', 'office cli lookup failed', { platform, err: String(err) })
      return undefined
    })
    located.set(platform, job)
    // A missing CLI is looked up again next time: the user may have installed it meanwhile.
    void job.then((hit) => {
      if (!hit && located.get(platform) === job) located.delete(platform)
    })
    return job
  }

  // ---- status ------------------------------------------------------------------------------------
  const statusCache = new Map<OfficePlatform, { at: number; value: Promise<OfficePlatformStatus> }>()
  const probeStatus = async (platform: OfficePlatform): Promise<OfficePlatformStatus> => {
    const module = modules[platform]
    const base = {
      platform,
      cli: { name: module.spec.bin },
      canDisconnect: module.spec.canDisconnect,
      checkedAt: now(),
    }
    const hit = await locate(platform)
    if (!hit) return { ...base, installed: false, auth: 'unauthorized' }
    const cli = { name: module.spec.bin, version: hit.version, path: hit.cli.path }
    try {
      const probe = await module.probe(hit.cli)
      return { ...base, installed: true, cli, auth: probe.auth, account: probe.account, detail: probe.detail }
    } catch (e) {
      return { ...base, installed: true, cli, auth: 'unknown', detail: e instanceof Error ? e.message : String(e) }
    }
  }
  const statusOf = (platform: OfficePlatform, refresh: boolean): Promise<OfficePlatformStatus> => {
    const cached = statusCache.get(platform)
    if (cached && !refresh && now() - cached.at < STATUS_TTL_MS) return cached.value
    const value = probeStatus(platform)
    statusCache.set(platform, { at: now(), value })
    return value
  }

  // ---- sessions ----------------------------------------------------------------------------------
  const runtimes = new Map<string, SessionRuntime>()
  const listeners = new Set<(session: OfficeConnectSession) => void>()
  const publish = (rt: SessionRuntime, patch: (s: OfficeConnectSession) => OfficeConnectSession) => {
    rt.session = { ...patch(rt.session), updatedAt: now() }
    for (const listener of [...listeners]) {
      try {
        listener(rt.session)
      } catch (err) {
        log('warn', 'office session listener failed', err)
      }
    }
  }
  const pruneFinished = () => {
    const finished = [...runtimes.values()].filter((r) => !isActive(r.session))
    for (const r of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED_SESSIONS)))
      runtimes.delete(r.session.id)
  }

  const install = async (
    module: PlatformModule,
    signal: AbortSignal,
    onDetail: (detail: string) => void,
  ): Promise<Located> => {
    const e = await env()
    const npm = await e.which('npm')
    if (!npm)
      throw new OfficeError(
        'cli_missing',
        `没有找到 ${module.spec.bin}，也没有找到 npm，无法自动安装`,
        module.spec.installCommand,
      )
    onDetail(module.spec.npmPackage)
    await mkdir(installHome, { recursive: true })
    const runner = await createCliRunner('npm', npm, e, deps.fallbackNode)
    const result = await runner.run(
      [
        'install',
        '--prefix',
        installDir,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        `${module.spec.npmPackage}@latest`,
      ],
      {
        signal,
        timeoutMs: 6 * 60_000,
        env: sandboxedInstallEnv(installHome, deps.env ?? process.env),
      },
    )
    if (result.aborted) throw new OfficeError('cancelled', '已取消')
    if (result.code !== 0 || result.timedOut) {
      log('warn', 'office cli install failed', {
        pkg: module.spec.npmPackage,
        code: result.code,
        stderr: result.stderr.slice(-2000),
      })
      const reason = result.timedOut ? '下载超时' : (result.stderr.trim().split('\n').at(-1) ?? '')
      throw new OfficeError(
        'install_failed',
        `安装 ${module.spec.npmPackage} 失败${reason ? `：${reason}` : ''}`,
        module.spec.installCommand,
      )
    }
    const hit = await locate(module.spec.platform, true)
    if (!hit)
      throw new OfficeError(
        'install_failed',
        `${module.spec.npmPackage} 安装完成，但没有找到 ${module.spec.bin}`,
        module.spec.installCommand,
      )
    return hit
  }

  const runSession = async (rt: SessionRuntime, req: ConnectRequest): Promise<OfficeConnectSession> => {
    const module = modules[req.platform]
    const signal = rt.controller.signal
    const setStep = (id: OfficeConnectStep['id'], state: OfficeConnectStep['state'], detail?: string) =>
      publish(rt, (s) => ({
        ...s,
        steps: s.steps.map((st) => (st.id === id ? { ...st, state, detail: detail ?? st.detail } : st)),
      }))
    await mkdir(join(deps.dataDir, 'work'), { recursive: true }).catch(() => {})
    const workDir = await mkdtemp(join(deps.dataDir, 'work', 'connect-')).catch(() => join(deps.dataDir, 'work'))
    const hooks: ConnectHooks = {
      signal,
      workDir,
      step: setStep,
      link: async (input) => {
        if (!hostMatches(input.url, module.spec.authHostSuffixes)) {
          log('warn', 'office auth link rejected', { platform: req.platform, url: input.url })
          return
        }
        const qrDataUrl = input.qrDataUrl?.startsWith('data:image/png;base64,')
          ? input.qrDataUrl
          : await renderQr(input.url).catch(() => undefined)
        let opened = false
        if (!signal.aborted) {
          try {
            await deps.openExternal(input.url)
            opened = true
          } catch (err) {
            log('warn', 'office auth link could not be opened', err)
          }
        }
        publish(rt, (s) => ({
          ...s,
          state: 'waiting',
          link: {
            purpose: input.purpose,
            url: input.url,
            qrDataUrl,
            userCode: input.userCode,
            expiresAt: input.expiresInSec ? now() + input.expiresInSec * 1000 : undefined,
            opened,
          },
        }))
      },
      clearLink: () =>
        publish(rt, (s) => ({ ...s, state: s.state === 'waiting' ? 'running' : s.state, link: undefined })),
    }
    const checkCancelled = () => {
      if (signal.aborted) throw new OfficeError('cancelled', '已取消')
    }
    try {
      setStep('install', 'running')
      const hit =
        (await locate(req.platform)) ?? (await install(module, signal, (d) => setStep('install', 'running', d)))
      checkCancelled()
      setStep('install', 'done', hit.version ? `${module.spec.bin} ${hit.version}` : module.spec.bin)
      await module.connect(hit.cli, hooks, { reauthorize: Boolean(req.reauthorize), domains: req.domains })
      checkCancelled()
      statusCache.delete(req.platform)
      const status = await statusOf(req.platform, true)
      publish(rt, (s) => ({
        ...s,
        state: 'done',
        link: undefined,
        status,
        steps: s.steps.map((st) => (st.state === 'pending' ? { ...st, state: 'skipped' } : st)),
      }))
    } catch (e) {
      const err = toOfficeError(e, signal)
      publish(rt, (s) => ({
        ...s,
        state: err.code === 'cancelled' ? 'cancelled' : 'failed',
        link: undefined,
        error: { code: err.code, message: err.message, command: err.command },
        steps: s.steps.map((st) =>
          st.state === 'running' ? { ...st, state: err.code === 'cancelled' ? 'pending' : 'failed' } : st,
        ),
      }))
      log(err.code === 'cancelled' ? 'info' : 'warn', 'office connect ended', {
        platform: req.platform,
        code: err.code,
        message: err.message,
      })
    } finally {
      statusCache.delete(req.platform)
      pruneFinished()
      if (workDir !== join(deps.dataDir, 'work')) await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
    return rt.session
  }

  const service: OfficeService = {
    spec: (platform) => modules[platform].spec,

    async status(opts = {}) {
      const platforms = opts.platforms ?? OFFICE_PLATFORMS
      return Promise.all(platforms.map((p) => statusOf(p, Boolean(opts.refresh))))
    },

    connect(req) {
      const running = [...runtimes.values()].find((r) => r.session.platform === req.platform && isActive(r.session))
      if (running) return { session: running.session, done: running.done }
      const module = modules[req.platform]
      const at = now()
      const rt: SessionRuntime = {
        session: {
          id: `ofc_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          platform: req.platform,
          state: 'running',
          steps: module.spec.steps.map((id) => ({ id, state: 'pending' })),
          callId: req.callId,
          startedAt: at,
          updatedAt: at,
        },
        controller: new AbortController(),
        done: Promise.resolve(undefined as unknown as OfficeConnectSession),
      }
      runtimes.set(rt.session.id, rt)
      publish(rt, (s) => s)
      rt.done = runSession(rt, req)
      return { session: rt.session, done: rt.done }
    },

    cancel(sessionId) {
      const rt = runtimes.get(sessionId)
      if (!rt || !isActive(rt.session)) return false
      rt.controller.abort()
      return true
    },

    async openLink(sessionId) {
      const link = runtimes.get(sessionId)?.session.link
      if (!link) return false
      await deps.openExternal(link.url)
      return true
    },

    sessions: () => [...runtimes.values()].map((r) => r.session).sort((a, b) => a.startedAt - b.startedAt),

    async disconnect(platform) {
      const module = modules[platform]
      if (!module.spec.canDisconnect)
        throw new OfficeError('invalid_input', `${module.spec.label}不支持在应用里退出登录`)
      const hit = await locate(platform)
      if (hit) await module.disconnect(hit.cli)
      statusCache.delete(platform)
      return statusOf(platform, true)
    },

    async pushTable(req, ctx) {
      const module = modules[req.platform]
      const { label, bin } = module.spec
      let table
      try {
        table = normalizeTable(req)
      } catch (e) {
        if (e instanceof TableValidationError) throw new OfficeError('invalid_input', e.message)
        throw e
      }
      let target: AppendTarget | undefined
      if (req.target?.pushId) {
        const previous = await history.get(req.target.pushId)
        if (!previous)
          throw new OfficeError('invalid_input', `找不到推送记录 ${req.target.pushId}，用 office_status 查看最近推送`)
        if (previous.platform !== req.platform)
          throw new OfficeError(
            'invalid_input',
            `推送记录 ${req.target.pushId} 属于${modules[previous.platform].spec.label}，不是${label}`,
          )
        target = { url: previous.url, coords: previous.target, sheetName: req.sheetName }
      } else if (req.target?.url) {
        if (!isOfficeHostUrl(req.platform, req.target.url))
          throw new OfficeError('invalid_input', `这不是${label}的表格链接：${req.target.url}`)
        target = { url: req.target.url, sheetName: req.sheetName }
      }

      const hit = await locate(req.platform)
      if (!hit) throw new OfficeError('cli_missing', `${label}还没有连接（本机没有 ${bin}），先调用 office_connect`)
      const probe = await module.probe(hit.cli, ctx.signal)
      if (probe.auth !== 'authorized') {
        statusCache.delete(req.platform)
        throw new OfficeError(
          'not_connected',
          `${label}${probe.auth === 'expired' ? '的授权已过期' : '还没有授权'}，先调用 office_connect`,
        )
      }

      await mkdir(join(deps.dataDir, 'work'), { recursive: true })
      const workDir = await mkdtemp(join(deps.dataDir, 'work', 'push-'))
      try {
        const pushCtx: PushContext = {
          cli: hit.cli,
          signal: ctx.signal,
          progress: ctx.progress,
          workDir,
          writeFile: (name, content) => writeFile(insideDir(workDir, name), content, { mode: 0o600 }),
        }
        const outcome = target
          ? await module.appendTable(pushCtx, table, target)
          : await module.createTable(pushCtx, table)
        const record: OfficePushRecord = {
          id: `push_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
          platform: req.platform,
          title: outcome.title,
          url: outcome.url,
          mode: outcome.mode,
          rows: outcome.rowsWritten,
          columns: table.columns.map((c) => c.name),
          target: outcome.target,
          createdAt: now(),
        }
        await history.append(record).catch((err) => log('warn', 'office push history write failed', err))
        ctx.progress('完成', 1)
        return { record, warnings: outcome.warnings }
      } catch (e) {
        const err = toOfficeError(e, ctx.signal)
        if (err.code === 'not_connected') statusCache.delete(req.platform)
        throw err
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    },

    recentPushes: (limit) => history.list(limit),

    commandClassifier() {
      const byBin = new Map(Object.values(modules).map((m) => [m.spec.bin, m]))
      return (argv) => {
        const bin = argv[0]?.split(/[\\/]/).pop()
        const module = bin ? byBin.get(bin) : undefined
        if (!module || !bin) return undefined
        const args = argv.slice(1)
        const allowKey = [bin, ...args.filter((a) => !a.startsWith('-')).slice(0, 2)].join(' ')
        const refusal = module.refusal(args)
        if (refusal) return { risk: 'destructive', note: refusal, allowKey }
        return module.isReadOnly(args) ? { risk: 'read', allowKey } : { risk: 'write', allowKey }
      }
    },

    writableRoots() {
      const home = homedir()
      return [
        installDir,
        join(deps.dataDir, 'files'),
        join(home, '.lark-cli'),
        join(home, '.dws'),
        join(home, '.local', 'share', 'dws-cli'),
        join(home, '.config', 'wecom'),
      ]
    },

    onSession(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    shutdown() {
      for (const rt of runtimes.values()) if (isActive(rt.session)) rt.controller.abort()
      killAllCliProcesses()
    },
  }
  return service
}

export function isActive(session: OfficeConnectSession): boolean {
  return session.state === 'running' || session.state === 'waiting'
}

/**
 * Environment for `npm install`. Vendor postinstall scripts do more than unpack a binary: dws copies
 * its agent skills into every agent home it can find (~/.claude/skills, ~/.agents/skills, ~/.hermes…).
 * AIWC installing a CLI must not reconfigure the user's other tools, so HOME and the per-agent
 * overrides point into the app's own directory — while npm keeps the user's registry, mirror and cache.
 */
export function sandboxedInstallEnv(sandboxHome: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const realHome = base.HOME || base.USERPROFILE || homedir()
  return {
    HOME: sandboxHome,
    USERPROFILE: sandboxHome,
    XDG_CONFIG_HOME: join(sandboxHome, '.config'),
    DWS_CONFIG_DIR: join(sandboxHome, '.dws'),
    CLAUDE_CONFIG_DIR: undefined,
    CODEX_HOME: undefined,
    HERMES_HOME: undefined,
    OPENCLAW_HOME: undefined,
    AUTOHAND_HOME: undefined,
    GROK_HOME: undefined,
    VIBE_HOME: undefined,
    npm_config_userconfig: base.npm_config_userconfig || join(realHome, '.npmrc'),
    npm_config_cache: base.npm_config_cache || join(realHome, '.npm'),
  }
}

function toOfficeError(e: unknown, signal?: AbortSignal): OfficeError {
  if (e instanceof OfficeError) return e
  if (signal?.aborted) return new OfficeError('cancelled', '已取消')
  return new OfficeError('cli_error', e instanceof Error ? e.message : String(e))
}

function insideDir(dir: string, name: string): string {
  const root = resolve(dir)
  const file = resolve(root, name)
  if (!file.startsWith(root + sep)) throw new OfficeError('invalid_input', `非法文件名：${name}`)
  return file
}

async function defaultRenderQr(content: string): Promise<string> {
  const mod = (await import('qrcode')) as unknown as {
    toDataURL?: (text: string, opts?: unknown) => Promise<string>
    default?: { toDataURL(text: string, opts?: unknown): Promise<string> }
  }
  const toDataURL = mod.toDataURL ?? mod.default?.toDataURL
  if (!toDataURL) throw new Error('qrcode unavailable')
  return toDataURL(content, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
}
