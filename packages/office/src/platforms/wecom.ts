/**
 * 企业微信 through wecom-cli. Connecting is one scan: `auth init --noninteractive --no-browser` prints a
 * QR page link, polls until the user scans it with 企业微信 (creating and binding a smart bot), then
 * stores the bot credentials. Tables are 智能表格 (smartsheet); cells are keyed by field title.
 * Select options need server-side option ids to write, so select columns are written as text.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  REFUSE_DELETE,
  REFUSE_LEADING_FLAG,
  runLinkedFlow,
  startsWithFlag,
} from './common'
import type { AuthProbe, PlatformModule, PushContext } from './types'

const AUTH_HOSTS = ['work.weixin.qq.com'] as const
const RECORD_BATCH = 200
const QR_FILE = 'wecom-qr.png'

async function pngDataUrl(file: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(file)
    return bytes.length > 0 && bytes.length < 2_000_000
      ? `data:image/png;base64,${bytes.toString('base64')}`
      : undefined
  } catch {
    return undefined
  }
}

export const wecom: PlatformModule = {
  spec: {
    platform: 'wecom',
    label: '企业微信',
    tableNoun: '智能表格',
    bin: 'wecom-cli',
    npmPackage: '@wecom/cli',
    installCommand: 'npm install -g @wecom/cli',
    authHostSuffixes: AUTH_HOSTS,
    steps: ['install', 'authorize', 'verify'],
    canDisconnect: false,
  },

  async probe(cli, signal) {
    const result = await cli.run(['auth', 'show'], { timeoutMs: 20_000, signal })
    return parseWecomStatus(`${result.stdout}\n${result.stderr}`)
  },

  async connect(cli, hooks, opts) {
    const before = await this.probe(cli, hooks.signal)
    if (before.auth === 'authorized' && !opts.reauthorize) {
      hooks.step('authorize', 'done', before.account?.id)
    } else {
      hooks.step('authorize', 'running')
      // The page link opens a browser page that shows the QR; the QR the 企业微信 app must scan encodes a
      // different binding URL that the CLI never prints as text — so it writes its own PNG for the card.
      const done = await runLinkedFlow(
        cli,
        ['auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', QR_FILE],
        hooks,
        {
          purpose: 'authorize',
          hostSuffixes: AUTH_HOSTS,
          // wecom-cli polls the scan for 5 minutes, then verifies the bot.
          timeoutMs: 7 * 60_000,
          cwd: hooks.workDir,
          prefer: (urls) => urls.find((u) => /\/ai\/qc\/gen/.test(u)),
          ready: (out) => /二维码已保存|等待扫码/.test(out),
          settleMs: 3000,
          enrich: async () => ({ qrDataUrl: await pngDataUrl(join(hooks.workDir, QR_FILE)) }),
          expiresInSec: () => 300,
        },
      )
      if (done.code !== 0)
        throw new OfficeError(
          /超时|timeout/i.test(done.stderr + done.stdout) ? 'timeout' : 'cli_error',
          meaningful(done.stdout, done.stderr) || '企业微信扫码未完成',
        )
      hooks.step('authorize', 'done')
    }
    hooks.step('verify', 'running')
    const final = await this.probe(cli, hooks.signal)
    if (final.auth !== 'authorized')
      throw new OfficeError('cli_error', final.detail ?? '企业微信机器人凭证没有生效，请重新连接')
    hooks.step('verify', 'done')
  },

  async disconnect() {
    throw new OfficeError('cli_error', '企业微信 CLI 没有退出登录命令；如需解绑，请在企业微信里删除该智能机器人')
  },

  async createTable(ctx, table) {
    ctx.progress(`创建智能表格「${table.title}」`, 0.05)
    const created = await wecomJson(ctx, [
      'smartsheet',
      'create',
      '--json',
      JSON.stringify({ name: table.title, sheet_title: table.sheetName, fields: table.columns.map(fieldSpec) }),
    ])
    const docid = findString(created, ['docid'])
    if (!docid) throw new OfficeError('cli_error', '企业微信没有返回新表格的 docid')
    const url = findString(created, ['url'])
    const written = await writeRecords(ctx, docid, table.sheetName, table)
    return {
      url,
      title: table.title,
      mode: 'create',
      rowsWritten: written,
      target: { docid, sheetTitle: table.sheetName },
      warnings: withSelectNote(table),
    }
  },

  async appendTable(ctx, table, target) {
    const docid = target.coords?.docid ?? /\/smartsheet\/([A-Za-z0-9_-]+)/.exec(target.url ?? '')?.[1]
    if (!docid)
      throw new OfficeError(
        'cli_error',
        '无法从链接中识别企业微信智能表格（链接形如 https://doc.weixin.qq.com/smartsheet/s3_…）',
      )
    let sheetTitle = target.sheetName ?? target.coords?.sheetTitle
    if (!sheetTitle) {
      const sheets =
        findArray(await wecomJson(ctx, ['smartsheet', 'sheets', 'list', '--json', JSON.stringify({ docid })]), [
          'sheets',
          'sheet_list',
        ]) ?? []
      sheetTitle = findString(sheets[0], ['title', 'sheet_title'])
    }
    if (!sheetTitle) throw new OfficeError('cli_error', '智能表格里没有可写入的子表')
    ctx.progress('读取已有字段', 0.05)
    const listed = await wecomJson(ctx, [
      'smartsheet',
      'fields',
      'list',
      '--json',
      JSON.stringify({ docid, sheet_title: sheetTitle, limit: 100 }),
    ])
    const existing = new Set(
      (findArray(listed, ['fields', 'field_list']) ?? [])
        .map((f) => findString(f, ['field_title', 'title']))
        .filter(Boolean),
    )
    const missing = table.columns.filter((c) => !existing.has(c.name))
    if (missing.length > 0) {
      ctx.progress(`补充 ${missing.length} 个字段`, 0.1)
      await wecomJson(ctx, [
        'smartsheet',
        'fields',
        'add',
        '--json',
        JSON.stringify({ docid, sheet_title: sheetTitle, fields: missing.map(fieldSpec) }),
      ])
    }
    const written = await writeRecords(ctx, docid, sheetTitle, table)
    const warnings = withSelectNote(table)
    if (missing.length > 0) warnings.push(`新增了字段：${missing.map((c) => c.name).join('、')}`)
    return {
      url: target.url ?? `https://doc.weixin.qq.com/smartsheet/${docid}`,
      title: table.title,
      mode: 'append',
      rowsWritten: written,
      target: { docid, sheetTitle },
      warnings,
    }
  },

  isReadOnly(args) {
    if (hasHelpFlag(args) || hasDryRun(args) || args.includes('--schema') || args.includes('--doc')) return true
    const words = commandWords(args)
    const [first, second] = words
    if (!first) return false
    if (first === 'auth') return second === 'show'
    if (first === 'schema') return true
    if (first === 'cache') return second === 'status'
    const verb = words.at(-1)
    return (
      words.length >= 2 &&
      isReadVerb(verb) &&
      !isDeleteVerb(verb) &&
      !args.includes('--output') &&
      !args.includes('-o') &&
      !args.includes('--output-dir')
    )
  },

  refusal(args) {
    if (startsWithFlag(args)) return REFUSE_LEADING_FLAG
    const words = commandWords(args)
    if (words[0] === 'auth') return REFUSE_CREDENTIALS
    if (words.some((w) => isDeleteVerb(w))) return REFUSE_DELETE
    return undefined
  },
}

export function parseWecomStatus(text: string): AuthProbe {
  const botId = /Bot ID:\s*(\S+)/i.exec(text)?.[1]
  if (/Status:\s*authorized\b/i.test(text) || /^\s*authorized\s*$/im.test(text))
    return { auth: 'authorized', account: botId ? { id: botId } : undefined }
  if (/unauthorized/i.test(text)) return { auth: 'unauthorized' }
  return { auth: 'unknown', detail: text.trim().split(/\r?\n/).at(-1) || '无法读取企业微信 CLI 状态' }
}

function fieldSpec(column: NormalizedColumn): Record<string, unknown> {
  const type =
    column.type === 'date'
      ? 'date_time'
      : column.type === 'select' || column.type === 'multi_select'
        ? 'text'
        : column.type
  return { field_title: column.name, field_type: type }
}

function cellValue(cell: Cell): unknown {
  switch (cell.type) {
    case 'date':
      return formatDate(cell.value, { seconds: true, forceTime: true })
    case 'url':
      return [{ text: cell.value, link: cell.value }]
    case 'multi_select':
      return cell.value.join('、')
    default:
      return cell.value
  }
}

function withSelectNote(table: NormalizedTable): string[] {
  const selects = table.columns.filter((c) => c.type === 'select' || c.type === 'multi_select').map((c) => c.name)
  return selects.length > 0
    ? [...table.warnings, `企业微信的单选/多选需要服务端选项 id，「${selects.join('、')}」已按文本写入`]
    : [...table.warnings]
}

async function writeRecords(
  ctx: PushContext,
  docid: string,
  sheetTitle: string,
  table: NormalizedTable,
): Promise<number> {
  const batches = chunk(table.rows, RECORD_BATCH)
  let written = 0
  for (const [i, batch] of batches.entries()) {
    ctx.progress(
      `写入 ${Math.min(written + batch.length, table.rows.length)}/${table.rows.length} 行`,
      0.15 + (0.85 * i) / Math.max(1, batches.length),
    )
    const records = batch.map((row) => ({
      values: Object.fromEntries(Object.entries(row).map(([name, cell]) => [name, cellValue(cell)])),
    }))
    try {
      await wecomJson(ctx, [
        'smartsheet',
        'records',
        'add',
        '--json',
        JSON.stringify({ docid, sheet_title: sheetTitle, records }),
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

async function wecomJson(ctx: PushContext, args: string[]): Promise<unknown> {
  const result = await ctx.cli.run(args, { signal: ctx.signal, cwd: ctx.workDir, timeoutMs: 120_000 })
  const json = parseJsonOutput(result.stdout)
  if (result.aborted) throw new OfficeError('cancelled', '已取消')
  if (result.timedOut) throw new OfficeError('timeout', '企业微信请求超时')
  if (result.spawnError) throw new OfficeError('cli_missing', result.spawnError)
  if (result.code !== 0 || envelopeFailed(json)) {
    const record = (json ?? {}) as Record<string, unknown>
    const error = record.error as Record<string, unknown> | undefined
    const code = record.errcode ?? error?.code
    const message = String(record.errmsg ?? error?.message ?? meaningful(result.stdout, result.stderr))
    if (code === 851003 || /no authority/i.test(message)) {
      throw new OfficeError(
        'cli_error',
        '企业微信限制：企业可见范围超过 10 人时，CLI 不能直接写入智能表格记录（851003）。可在该子表的「接收外部数据」里开启 Webhook 后改用 Webhook 写入。',
      )
    }
    if (error?.type === 'AuthError' || /auth|凭证|token/i.test(message))
      throw new OfficeError('not_connected', `企业微信未授权：${message}`)
    throw new OfficeError(
      'cli_error',
      code !== undefined ? `${message}（${String(code)}）` : message || '企业微信 CLI 执行失败',
    )
  }
  return json
}

function meaningful(stdout: string, stderr: string): string {
  const json = parseJsonOutput(stdout) ?? parseJsonOutput(stderr)
  const message = findString(json, ['message', 'errmsg', 'msg'])
  if (message) return message
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/[█▀▄◇●│]/.test(l))
  return lines.at(-1) ?? ''
}
