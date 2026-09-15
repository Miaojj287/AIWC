/**
 * 钉钉 through dws (DingTalk Workspace CLI). Connecting is one browser step: the OAuth device flow
 * (`auth login --device --no-browser --recommend`) prints a verification link and blocks until the user
 * picks an organisation and approves. The organisation must have CLI access enabled by an admin.
 * Tables are AI 表格 (aitable); cells are keyed by fieldId, so fields are read back after creation.
 */
import { findArray, findString, parseJsonOutput } from '../cli/output'
import { OfficeError, envelopeFailed } from '../cli/runner'
import { chunk, formatDate, type Cell, type NormalizedColumn, type NormalizedTable } from '../push/table'
import {
  commandWords,
  hasDryRun,
  hasHelpFlag,
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
import type { AppendTarget, AuthProbe, PlatformModule, PushContext } from './types'

const AUTH_HOSTS = ['dingtalk.com', 'dingtalk.io'] as const
const RECORD_BATCH = 100

export const dingtalk: PlatformModule = {
  spec: {
    platform: 'dingtalk',
    label: '钉钉',
    tableNoun: 'AI 表格',
    bin: 'dws',
    npmPackage: 'dingtalk-workspace-cli',
    installCommand: 'npm install -g dingtalk-workspace-cli',
    authHostSuffixes: AUTH_HOSTS,
    steps: ['install', 'authorize', 'verify'],
    canDisconnect: true,
  },

  async probe(cli, signal) {
    const result = await cli.run(['auth', 'status', '--format', 'json'], { timeoutMs: 25_000, signal })
    return parseDingtalkStatus(
      parseJsonOutput(result.stdout) ?? parseJsonOutput(result.stderr),
      `${result.stderr}\n${result.stdout}`,
    )
  },

  async connect(cli, hooks, opts) {
    const before = await this.probe(cli, hooks.signal)
    if (before.auth === 'authorized' && !opts.reauthorize) {
      hooks.step('authorize', 'done', before.account?.name)
    } else {
      hooks.step('authorize', 'running')
      const done = await runLinkedFlow(cli, ['auth', 'login', '--device', '--no-browser', '--recommend'], hooks, {
        purpose: 'authorize',
        hostSuffixes: AUTH_HOSTS,
        timeoutMs: 15 * 60_000,
        // dws prints the manual-entry page first and the link with the code filled in after it; only
        // the latter lets a click (or a scan) finish without typing the code.
        prefer: (urls) => urls.find((u) => userCodeInUrl(u)),
        settleMs: 1500,
        userCode: (out, url) => userCodeInUrl(url) ?? parseDeviceOutput(out).userCode,
        expiresInSec: (out) => parseDeviceOutput(out).expiresInSec,
      })
      if (done.code !== 0) {
        const message = meaningful(done.stdout, done.stderr)
        if (/管理员|未开启|CLI 访问|not enabled|admin/i.test(message))
          throw new OfficeError(
            'needs_admin',
            message || '所在组织还没有开启钉钉 CLI 访问，请联系管理员在开发者平台「CLI 访问管理」中开启',
          )
        throw new OfficeError('cli_error', message || '钉钉授权未完成')
      }
      hooks.step('authorize', 'done')
    }
    hooks.step('verify', 'running')
    const final = await this.probe(cli, hooks.signal)
    if (final.auth !== 'authorized') {
      const detail = final.detail ?? '授权没有生效，请重新连接'
      throw new OfficeError(/管理员|未开启|CLI 访问/.test(detail) ? 'needs_admin' : 'cli_error', detail)
    }
    hooks.step('verify', 'done')
  },

  async disconnect(cli) {
    const result = await cli.run(['auth', 'logout', '--yes'], { timeoutMs: 20_000 })
    if (result.code !== 0)
      throw new OfficeError('cli_error', meaningful(result.stdout, result.stderr) || '退出钉钉登录失败')
  },

  async createTable(ctx, table) {
    ctx.progress(`创建 AI 表格「${table.title}」`, 0.05)
    const tables = [{ name: table.sheetName, fields: table.columns.map((c) => fieldSpec(c, table)) }]
    const created = await dwsJson(ctx, [
      'aitable',
      '+base-bootstrap',
      '--name',
      table.title,
      '--tables',
      JSON.stringify(tables),
    ])
    const baseId = findString(created, ['baseId'])
    const tableList = findArray(created, ['tables']) ?? []
    const tableId = findString(tableList[0], ['tableId', 'sheetId']) ?? findString(created, ['tableId', 'sheetId'])
    if (!baseId || !tableId) throw new OfficeError('cli_error', '钉钉没有返回新表格的 baseId / tableId')
    const written = await writeRecords(ctx, baseId, tableId, table)
    return {
      url: tableUrl(baseId, tableId),
      title: table.title,
      mode: 'create',
      rowsWritten: written,
      target: { baseId, tableId },
      warnings: table.warnings,
    }
  },

  async appendTable(ctx, table, target) {
    const { baseId, tableId } = await resolveTarget(ctx, target)
    const fields = await readFields(ctx, baseId, tableId)
    const missing = table.columns.filter((c) => !fields.has(c.name))
    if (missing.length > 0) {
      ctx.progress(`补充 ${missing.length} 个字段`, 0.1)
      await dwsJson(ctx, [
        'aitable',
        'field',
        'create',
        '--base-id',
        baseId,
        '--table-id',
        tableId,
        '--fields',
        JSON.stringify(missing.map((c) => fieldSpec(c, table))),
      ])
    }
    const written = await writeRecords(ctx, baseId, tableId, table)
    const warnings =
      missing.length > 0 ? [...table.warnings, `新增了字段：${missing.map((c) => c.name).join('、')}`] : table.warnings
    return {
      url: tableUrl(baseId, tableId),
      title: table.title,
      mode: 'append',
      rowsWritten: written,
      target: { baseId, tableId },
      warnings,
    }
  },

  isReadOnly(args) {
    if (hasHelpFlag(args) || hasDryRun(args)) return true
    const words = commandWords(args)
    const [first, second] = words
    if (!first) return false
    if (['schema', 'version', 'help'].includes(first)) return true
    if (first === 'auth') return second === 'status'
    if (first === 'profile') return second === 'list'
    if (first === 'skill') return ['list', 'show', 'read', 'cat'].includes(second ?? '')
    if (first === 'api') return (second ?? '').toUpperCase() === 'GET'
    const verb = words.find((w) => w.startsWith('+')) ?? words.at(-1)
    return words.length >= 2 && isReadVerb(verb) && !isDeleteVerb(verb) && !/export|download/i.test(words.join(' '))
  },

  refusal(args) {
    if (startsWithFlag(args)) return REFUSE_LEADING_FLAG
    const words = commandWords(args)
    const [first, second] = words
    if (first === 'auth' || first === 'profile') return REFUSE_CREDENTIALS
    if (first === 'upgrade' || first === 'event' || first === 'connect' || (first === 'skill' && second === 'setup'))
      return REFUSE_DAEMON
    if (first === 'api' && (second ?? '').toUpperCase() === 'DELETE') return REFUSE_DELETE
    if (words.some((w) => isDeleteVerb(w))) return REFUSE_DELETE
    return undefined
  },
}

/** Code and expiry from the device-flow box, in either language dws prints it. */
export function parseDeviceOutput(output: string): { userCode?: string; expiresInSec?: number } {
  const userCode = /(?:authorization code|授权码)\s*[:：]\s*([A-Z0-9]{4}-?[A-Z0-9]{4})/i.exec(output)?.[1]
  const expiry = /expire in (\d+) seconds|(\d+)\s*秒后过期/i.exec(output)
  const seconds = expiry ? Number(expiry[1] ?? expiry[2]) : NaN
  return { userCode, expiresInSec: Number.isFinite(seconds) ? seconds : undefined }
}

export function parseDingtalkStatus(json: unknown, rawText = ''): AuthProbe {
  if (!json || typeof json !== 'object')
    return { auth: 'unknown', detail: meaningful(rawText, '') || '无法读取钉钉 CLI 状态' }
  const r = json as Record<string, unknown>
  const account = { name: str(r.user_name), tenant: str(r.corp_name), id: str(r.user_id) }
  if (r.authenticated === true) return { auth: 'authorized', account }
  const detail = [str(r.message), str(r.hint)].filter(Boolean).join('；') || undefined
  if (/expire|过期|refresh/i.test(`${String(r.reason ?? '')} ${detail ?? ''}`)) return { auth: 'expired', detail }
  return { auth: 'unauthorized', detail: detail === '未登录' ? undefined : detail }
}

function fieldSpec(column: NormalizedColumn, table: NormalizedTable): Record<string, unknown> {
  switch (column.type) {
    case 'number':
      return { fieldName: column.name, type: 'number' }
    case 'date': {
      const withTime = table.rows.some(
        (row) =>
          row[column.name]?.type === 'date' && (row[column.name] as Extract<Cell, { type: 'date' }>).value.hasTime,
      )
      return {
        fieldName: column.name,
        type: 'date',
        config: { formatter: withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD' },
      }
    }
    case 'select':
      return {
        fieldName: column.name,
        type: 'singleSelect',
        config: { options: column.options.map((name) => ({ name })) },
      }
    case 'multi_select':
      return {
        fieldName: column.name,
        type: 'multipleSelect',
        config: { options: column.options.map((name) => ({ name })) },
      }
    case 'checkbox':
      return { fieldName: column.name, type: 'checkbox' }
    case 'url':
      return { fieldName: column.name, type: 'url' }
    default:
      return { fieldName: column.name, type: 'text' }
  }
}

function cellValue(cell: Cell): unknown {
  switch (cell.type) {
    case 'date':
      return formatDate(cell.value)
    case 'url':
      return { text: cell.value, link: cell.value }
    default:
      return cell.value
  }
}

async function readFields(ctx: PushContext, baseId: string, tableId: string): Promise<Map<string, string>> {
  const listed = await dwsJson(ctx, ['aitable', 'field', 'list', '--base-id', baseId, '--table-id', tableId])
  const fields = findArray(listed, ['fields', 'fieldList', 'items']) ?? []
  const map = new Map<string, string>()
  for (const f of fields) {
    const name = findString(f, ['fieldName', 'name'])
    const id = findString(f, ['fieldId', 'id'])
    if (name && id && !map.has(name)) map.set(name, id)
  }
  return map
}

async function writeRecords(
  ctx: PushContext,
  baseId: string,
  tableId: string,
  table: NormalizedTable,
): Promise<number> {
  if (table.rows.length === 0) return 0
  const fieldIds = await readFields(ctx, baseId, tableId)
  const missing = table.columns.filter((c) => !fieldIds.has(c.name)).map((c) => c.name)
  if (missing.length === table.columns.length) throw new OfficeError('cli_error', '钉钉没有返回字段信息，无法写入记录')
  const batches = chunk(table.rows, RECORD_BATCH)
  let written = 0
  for (const [i, batch] of batches.entries()) {
    ctx.progress(
      `写入 ${Math.min(written + batch.length, table.rows.length)}/${table.rows.length} 行`,
      0.15 + (0.85 * i) / Math.max(1, batches.length),
    )
    const records = batch.map((row) => ({
      cells: Object.fromEntries(
        Object.entries(row).flatMap(([name, cell]) =>
          fieldIds.has(name) ? [[fieldIds.get(name) as string, cellValue(cell)]] : [],
        ),
      ),
    }))
    const file = `records-${i}.json`
    await ctx.writeFile(file, JSON.stringify(records))
    try {
      await dwsJson(ctx, [
        'aitable',
        'record',
        'create',
        '--base-id',
        baseId,
        '--table-id',
        tableId,
        '--records-file',
        `./${file}`,
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

async function resolveTarget(ctx: PushContext, target: AppendTarget): Promise<{ baseId: string; tableId: string }> {
  if (target.coords?.baseId && target.coords.tableId && !target.sheetName)
    return { baseId: target.coords.baseId, tableId: target.coords.tableId }
  let baseId = target.coords?.baseId
  let tableId: string | undefined
  if (!baseId && target.url) {
    const m = /\/i\/nodes\/([A-Za-z0-9_-]+)/.exec(target.url)
    baseId = m?.[1]
    tableId = /sheetId(?:%3D|=)([A-Za-z0-9_-]+)/i.exec(target.url)?.[1]
    if (!baseId) {
      const resolved = await dwsJson(ctx, ['aitable', '+url-resolve', '--url', target.url])
      baseId = findString(resolved, ['baseId'])
      tableId = findString(resolved, ['tableId', 'sheetId'])
    }
  }
  if (!baseId) throw new OfficeError('cli_error', '无法从链接中识别钉钉 AI 表格')
  if (!tableId || target.sheetName) {
    const listed = await dwsJson(ctx, ['aitable', '+list-tables', '--base', baseId])
    const tables = findArray(listed, ['tables', 'items', 'list']) ?? []
    const wanted = target.sheetName
      ? tables.find((t) => findString(t, ['tableName', 'name']) === target.sheetName)
      : tables[0]
    tableId = (wanted ? findString(wanted, ['tableId', 'sheetId', 'id']) : undefined) ?? tableId
  }
  if (!tableId)
    throw new OfficeError(
      'cli_error',
      target.sheetName ? `表格里没有名为「${target.sheetName}」的数据表` : '表格里没有可写入的数据表',
    )
  return { baseId, tableId }
}

async function dwsJson(ctx: PushContext, args: string[]): Promise<unknown> {
  const full = [...args, '--format', 'json', '--yes']
  const result = await ctx.cli.run(full, { signal: ctx.signal, cwd: ctx.workDir, timeoutMs: 180_000 })
  const json = parseJsonOutput(result.stdout)
  if (result.aborted) throw new OfficeError('cancelled', '已取消')
  if (result.timedOut) throw new OfficeError('timeout', '钉钉请求超时')
  if (result.spawnError) throw new OfficeError('cli_missing', result.spawnError)
  // Composite shortcuts report partial work in a top-level status rather than the exit code.
  const status = json && typeof json === 'object' ? (json as Record<string, unknown>).status : undefined
  if (result.code !== 0 || envelopeFailed(json) || status === 'unknown' || status === 'partial_success') {
    const message = meaningful(result.stdout, result.stderr)
    if (/未登录|login|token|unauthori[sz]ed|权限/i.test(message))
      throw new OfficeError('not_connected', `钉钉未授权或权限不足：${message}`)
    throw new OfficeError('cli_error', message || '钉钉 CLI 执行失败')
  }
  return json
}

function tableUrl(baseId: string, tableId: string): string {
  return `https://alidocs.dingtalk.com/i/nodes/${encodeURIComponent(baseId)}?iframeQuery=${encodeURIComponent(`sheetId=${tableId}`)}`
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function meaningful(stdout: string, stderr: string): string {
  const json = parseJsonOutput(stderr) ?? parseJsonOutput(stdout)
  const message = findString(json, ['message', 'msg', 'error', 'hint'])
  if (message) return message
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/[█▀▄│╭╰]/.test(l))
  return lines.at(-1) ?? ''
}
