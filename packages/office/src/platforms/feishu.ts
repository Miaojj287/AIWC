/**
 * 飞书 through lark-cli. Connecting is two browser steps, both started by the CLI itself:
 *   1. `config init --new` — creates the CLI's own app on open.feishu.cn (blocks until done);
 *   2. `auth login --no-wait --json` → device code → `auth login --device-code` (blocks until granted).
 * Tables are 多维表格 (Base), always created and written as the user (`--as user`) so the user owns them.
 */
import { findArray, findString, parseJsonOutput } from '../cli/output'
import { OfficeError, envelopeFailed, type CliRunner } from '../cli/runner'
import { chunk, formatDate, type Cell, type NormalizedColumn, type NormalizedTable } from '../push/table'
import {
  commandWords,
  hasDryRun,
  hasHelpFlag,
  hostMatches,
  isDeleteVerb,
  isReadVerb,
  REFUSE_CREDENTIALS,
  REFUSE_DAEMON,
  REFUSE_DELETE,
  REFUSE_LEADING_FLAG,
  runLinkedFlow,
  startsWithFlag,
  userCodeInUrl,
} from './common'
import type {
  AppendTarget,
  AuthProbe,
  ConnectHooks,
  ConnectOptions,
  PlatformModule,
  PushContext,
  PushOutcome,
} from './types'

/** What AIWC asks for by default: tables, sheets, docs, drive / wiki placement, messages, contacts. */
export const FEISHU_DEFAULT_DOMAINS = ['base', 'sheets', 'docs', 'drive', 'wiki', 'im', 'contact'] as const

const AUTH_HOSTS = ['feishu.cn', 'larksuite.com', 'larkoffice.com'] as const
const RECORD_BATCH = 200
const TIMEZONE = 'Asia/Shanghai'

export const feishu: PlatformModule = {
  spec: {
    platform: 'feishu',
    label: '飞书',
    tableNoun: '多维表格',
    bin: 'lark-cli',
    npmPackage: '@larksuite/cli',
    installCommand: 'npm install -g @larksuite/cli',
    authHostSuffixes: AUTH_HOSTS,
    steps: ['install', 'app', 'authorize', 'verify'],
    canDisconnect: true,
  },

  async probe(cli, signal) {
    const result = await cli.run(['auth', 'status', '--json'], { timeoutMs: 20_000, signal })
    return parseFeishuStatus(
      parseJsonOutput(result.stdout) ?? parseJsonOutput(result.stderr),
      result.stderr || result.stdout,
    )
  },

  async connect(cli, hooks, opts) {
    let probe = await this.probe(cli, hooks.signal)
    if (probe.appConfigured === false) {
      hooks.step('app', 'running')
      const done = await runLinkedFlow(cli, ['config', 'init', '--new'], hooks, {
        purpose: 'app',
        hostSuffixes: AUTH_HOSTS,
        timeoutMs: 15 * 60_000,
        // The setup page, not a docs link that may be printed alongside it.
        prefer: (urls) => urls.find((u) => /\/page\/cli/.test(u)),
        settleMs: 1500,
        userCode: (_out, url) => userCodeInUrl(url),
      })
      if (done.code !== 0)
        throw new OfficeError('cli_error', lastMeaningful(done.stdout, done.stderr) || '飞书应用创建未完成')
      hooks.step('app', 'done')
      probe = await this.probe(cli, hooks.signal)
    } else {
      hooks.step('app', 'done')
    }

    if (probe.auth === 'authorized' && !opts.reauthorize && !opts.domains?.length) {
      hooks.step('authorize', 'done', probe.account?.name)
    } else {
      await authorize(cli, hooks, opts)
    }

    hooks.step('verify', 'running')
    const final = await this.probe(cli, hooks.signal)
    if (final.auth !== 'authorized') throw new OfficeError('cli_error', final.detail ?? '授权没有生效，请重新连接')
    hooks.step('verify', 'done')
  },

  async disconnect(cli) {
    await cli.json(['auth', 'logout', '--json'], { timeoutMs: 20_000 })
  },

  async createTable(ctx, table) {
    ctx.progress(`创建多维表格「${table.title}」`, 0.05)
    const fields = table.columns.map(fieldSpec)
    const created = await larkJson(ctx, [
      'base',
      '+base-create',
      '--as',
      'user',
      '--name',
      table.title,
      '--table-name',
      table.sheetName,
      '--time-zone',
      TIMEZONE,
      '--fields',
      JSON.stringify(fields),
    ])
    const data = dataOf(created)
    const base = (data?.base ?? data) as unknown
    const baseToken = findString(base, ['base_token', 'app_token'])
    const tableId = findString(data?.table, ['id', 'table_id'])
    if (!baseToken || !tableId) throw new OfficeError('cli_error', '飞书没有返回新表格的 base_token / table_id')
    const url = withTable(findString(base, ['url']) ?? `https://feishu.cn/base/${baseToken}`, tableId)
    const written = await writeRecords(ctx, baseToken, tableId, table, table.columns)
    return {
      url,
      title: table.title,
      mode: 'create',
      rowsWritten: written,
      target: { baseToken, tableId },
      warnings: table.warnings,
    }
  },

  async appendTable(ctx, table, target) {
    const coords = await resolveTarget(ctx, target)
    ctx.progress('读取已有字段', 0.05)
    const listed = await larkJson(ctx, [
      'base',
      '+field-list',
      '--as',
      'user',
      '--base-token',
      coords.baseToken,
      '--table-id',
      coords.tableId,
      '--limit',
      '200',
    ])
    const existing = new Set(
      (findArray(dataOf(listed), ['fields', 'items']) ?? [])
        .map((f) => findString(f, ['name', 'field_name']))
        .filter(Boolean),
    )
    const missing = table.columns.filter((c) => !existing.has(c.name))
    if (missing.length > 0) {
      ctx.progress(`补充 ${missing.length} 个字段`, 0.1)
      await larkJson(ctx, [
        'base',
        '+field-create',
        '--as',
        'user',
        '--base-token',
        coords.baseToken,
        '--table-id',
        coords.tableId,
        '--json',
        JSON.stringify(missing.map(fieldSpec)),
      ])
    }
    const written = await writeRecords(ctx, coords.baseToken, coords.tableId, table, table.columns)
    const url =
      target.url && hostMatches(target.url, AUTH_HOSTS)
        ? target.url
        : withTable(`https://feishu.cn/base/${coords.baseToken}`, coords.tableId)
    const warnings =
      missing.length > 0 ? [...table.warnings, `新增了字段：${missing.map((c) => c.name).join('、')}`] : table.warnings
    return {
      url,
      title: table.title,
      mode: 'append',
      rowsWritten: written,
      target: coords,
      warnings,
    } satisfies PushOutcome
  },

  isReadOnly(args) {
    if (hasHelpFlag(args) || hasDryRun(args)) return true
    const [first, second, third] = commandWords(args)
    if (!first) return false
    if (['schema', 'whoami', 'doctor', 'help', 'version'].includes(first)) return true
    if (first === 'skills') return second === undefined || second === 'list' || second === 'read'
    if (first === 'auth') return ['status', 'check', 'scopes', 'list'].includes(second ?? '')
    if (first === 'config') return second === 'show'
    if (first === 'api') return (second ?? '').toUpperCase() === 'GET'
    // `<domain> +shortcut` or `<domain> <resource> <method>`
    const verb = second?.startsWith('+') ? second : third
    return isReadVerb(verb) && !isDeleteVerb(verb)
  },

  refusal(args) {
    if (startsWithFlag(args)) return REFUSE_LEADING_FLAG
    const [first, second, third] = commandWords(args)
    if (first === 'auth' || first === 'config' || first === 'profile') return REFUSE_CREDENTIALS
    if (first === 'update' || first === 'event' || (first === 'apps' && /dev|serve/.test(second ?? '')))
      return REFUSE_DAEMON
    if (first === 'api' && (second ?? '').toUpperCase() === 'DELETE') return REFUSE_DELETE
    const verb = second?.startsWith('+') ? second : third
    if (isDeleteVerb(verb) || isDeleteVerb(second)) return REFUSE_DELETE
    return undefined
  },
}

async function authorize(cli: CliRunner, hooks: ConnectHooks, opts: ConnectOptions): Promise<void> {
  hooks.step('authorize', 'running')
  const domains = opts.domains?.length
    ? [...new Set([...FEISHU_DEFAULT_DOMAINS, ...opts.domains])]
    : [...FEISHU_DEFAULT_DOMAINS]
  const start = await cli.run(['auth', 'login', '--domain', domains.join(','), '--no-wait', '--json'], {
    timeoutMs: 30_000,
    signal: hooks.signal,
  })
  if (start.aborted) throw new OfficeError('cancelled', '已取消')
  const json = parseJsonOutput(start.stdout)
  const url = findString(json, ['verification_url', 'verification_uri_complete', 'verification_uri'])
  const deviceCode = findString(json, ['device_code'])
  if (!url || !deviceCode)
    throw new OfficeError('cli_error', lastMeaningful(start.stdout, start.stderr) || '飞书没有返回授权链接')
  const expiresIn = numberField(json, 'expires_in') ?? 600
  await hooks.link({
    purpose: 'authorize',
    url,
    userCode: findString(json, ['user_code']) ?? userCodeInUrl(url),
    expiresInSec: expiresIn,
  })
  const done = await cli.run(['auth', 'login', '--device-code', deviceCode], {
    timeoutMs: (expiresIn + 30) * 1000,
    signal: hooks.signal,
  })
  hooks.clearLink()
  if (done.aborted) throw new OfficeError('cancelled', '已取消')
  if (done.timedOut) throw new OfficeError('timeout', '授权链接已过期，请重新连接')
  // A non-zero exit can still mean "authorized, but some requested scopes were not granted"; the
  // status probe that follows is the source of truth.
  hooks.step('authorize', 'done', /Authorized account:\s*([^\n(]+)/.exec(done.stdout + done.stderr)?.[1]?.trim())
}

export function parseFeishuStatus(json: unknown, rawText = ''): AuthProbe {
  if (!json || typeof json !== 'object')
    return { auth: 'unknown', detail: lastMeaningful(rawText, '') || '无法读取飞书 CLI 状态' }
  const record = json as Record<string, unknown>
  const error = record.error as Record<string, unknown> | undefined
  if (record.ok === false || error) {
    if (error?.subtype === 'not_configured' || /not configured/i.test(String(error?.message ?? '')))
      return { auth: 'unauthorized', appConfigured: false }
    return { auth: 'unknown', detail: String(error?.message ?? '飞书 CLI 状态异常') }
  }
  const identities = (record.identities ?? {}) as Record<string, Record<string, unknown> | undefined>
  const user = identities.user
  const appConfigured = typeof record.appId === 'string' && record.appId.length > 0
  const account = user ? { name: str(user.userName), id: str(user.openId) } : undefined
  const status = String(user?.status ?? user?.tokenStatus ?? '')
  if (user && user.available !== false && /^(ready|needs_refresh|valid)$/i.test(status))
    return { auth: 'authorized', account, appConfigured }
  if (user && /expire/i.test(status)) return { auth: 'expired', account, appConfigured }
  return { auth: 'unauthorized', appConfigured, account: account?.name ? account : undefined }
}

function fieldSpec(column: NormalizedColumn): Record<string, unknown> {
  switch (column.type) {
    case 'number':
      return { type: 'number', name: column.name }
    case 'date':
      return { type: 'datetime', name: column.name }
    case 'select':
    case 'multi_select':
      return {
        type: 'select',
        name: column.name,
        multiple: column.type === 'multi_select',
        options: column.options.map((name) => ({ name })),
      }
    case 'checkbox':
      return { type: 'checkbox', name: column.name }
    case 'url':
      return { type: 'text', name: column.name, style: { type: 'url' } }
    default:
      return { type: 'text', name: column.name }
  }
}

function cellValue(cell: Cell): unknown {
  switch (cell.type) {
    case 'date':
      return formatDate(cell.value, { forceTime: cell.value.hasTime })
    case 'select':
      return [cell.value]
    default:
      return cell.value
  }
}

async function writeRecords(
  ctx: PushContext,
  baseToken: string,
  tableId: string,
  table: NormalizedTable,
  columns: NormalizedColumn[],
): Promise<number> {
  const names = new Set(columns.map((c) => c.name))
  const batches = chunk(table.rows, RECORD_BATCH)
  let written = 0
  for (const [i, batch] of batches.entries()) {
    ctx.progress(
      `写入 ${Math.min(written + batch.length, table.rows.length)}/${table.rows.length} 行`,
      0.15 + (0.85 * i) / Math.max(1, batches.length),
    )
    const records = batch.map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([k]) => names.has(k))
          .map(([k, cell]) => [k, cellValue(cell)]),
      ),
    )
    const file = `records-${i}.json`
    await ctx.writeFile(file, JSON.stringify({ create_records: records }))
    try {
      await larkJson(ctx, [
        'base',
        '+record-batch-create',
        '--as',
        'user',
        '--base-token',
        baseToken,
        '--table-id',
        tableId,
        '--json',
        `@${file}`,
      ])
    } catch (e) {
      if (written > 0 && e instanceof OfficeError)
        throw new OfficeError(e.code, `已写入 ${written} 行后失败：${e.message}`)
      throw e
    }
    written += batch.length
  }
  return written
}

async function resolveTarget(ctx: PushContext, target: AppendTarget): Promise<{ baseToken: string; tableId: string }> {
  if (target.coords?.baseToken && target.coords.tableId)
    return { baseToken: target.coords.baseToken, tableId: target.coords.tableId }
  if (!target.url) throw new OfficeError('cli_error', '追加需要表格链接')
  const direct = /\/base\/([A-Za-z0-9]+)/.exec(target.url)
  let baseToken = direct?.[1]
  let tableId = safeUrl(target.url)?.searchParams.get('table') ?? undefined
  if (!baseToken) {
    const resolved = dataOf(await larkJson(ctx, ['base', '+url-resolve', '--as', 'user', '--url', target.url]))
    baseToken = findString(resolved, ['base_token', 'app_token', 'obj_token'])
    tableId ??= findString(resolved, ['table_id'])
  }
  if (!baseToken) throw new OfficeError('cli_error', '无法从链接中识别飞书多维表格')
  if (!tableId || target.sheetName) {
    const tables =
      findArray(dataOf(await larkJson(ctx, ['base', '+table-list', '--as', 'user', '--base-token', baseToken])), [
        'tables',
        'items',
      ]) ?? []
    const wanted = target.sheetName ? tables.find((t) => findString(t, ['name']) === target.sheetName) : tables[0]
    tableId = (wanted ? findString(wanted, ['id', 'table_id']) : undefined) ?? tableId
  }
  if (!tableId)
    throw new OfficeError(
      'cli_error',
      target.sheetName ? `表格里没有名为「${target.sheetName}」的数据表` : '表格里没有可写入的数据表',
    )
  return { baseToken, tableId }
}

async function larkJson(ctx: PushContext, args: string[]): Promise<unknown> {
  const result = await ctx.cli.run(args, { signal: ctx.signal, cwd: ctx.workDir, timeoutMs: 120_000 })
  const json = parseJsonOutput(result.stdout)
  if (result.code === 10) throw new OfficeError('cli_error', '飞书把这个操作标记为高风险，需要用户确认后才能执行')
  if (result.aborted) throw new OfficeError('cancelled', '已取消')
  if (result.timedOut) throw new OfficeError('timeout', '飞书请求超时')
  if (result.spawnError) throw new OfficeError('cli_missing', result.spawnError)
  if (result.code !== 0 || envelopeFailed(json)) {
    const errJson = parseJsonOutput(result.stderr) ?? json
    const err = (errJson as { error?: { message?: string; hint?: string; code?: unknown } } | undefined)?.error
    const message = err?.message
      ? `${err.message}${err.hint ? `（${err.hint}）` : ''}`
      : lastMeaningful(result.stdout, result.stderr)
    if (/scope|permission|unauthori[sz]ed|token/i.test(message))
      throw new OfficeError('not_connected', `飞书权限不足：${message}`)
    throw new OfficeError('cli_error', message || '飞书 CLI 执行失败')
  }
  return json
}

function dataOf(json: unknown): Record<string, unknown> | undefined {
  if (!json || typeof json !== 'object') return undefined
  const data = (json as Record<string, unknown>).data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : (json as Record<string, unknown>)
}

function withTable(url: string, tableId: string): string {
  const parsed = safeUrl(url)
  if (!parsed) return url
  if (!parsed.searchParams.has('table')) parsed.searchParams.set('table', tableId)
  return parsed.toString()
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

function numberField(json: unknown, key: string): number | undefined {
  const v = json && typeof json === 'object' ? (json as Record<string, unknown>)[key] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function lastMeaningful(stdout: string, stderr: string): string {
  const json = parseJsonOutput(stderr) ?? parseJsonOutput(stdout)
  const message = findString(json, ['message', 'msg', 'hint'])
  if (message) return message
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/[█▀▄]/.test(l))
  return lines.at(-1) ?? ''
}
