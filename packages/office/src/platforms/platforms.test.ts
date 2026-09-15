import { describe, expect, it, vi } from 'vitest'
import type { RunResult } from '@aiwc/shell'
import type { CliRunner, CliRunOptions } from '../cli/runner'
import { normalizeTable } from '../push/table'
import { runLinkedFlow, userCodeInUrl } from './common'
import { dingtalk, parseDeviceOutput, parseDingtalkStatus } from './dingtalk'
import { feishu, parseFeishuStatus } from './feishu'
import type { AuthLinkInput, ConnectHooks, PushContext } from './types'
import { parseWecomStatus, wecom } from './wecom'

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false })

function fakeCli(name: string, respond: (args: readonly string[], opts?: CliRunOptions) => RunResult) {
  const calls: Array<{ args: readonly string[]; cwd?: string }> = []
  const cli: CliRunner = {
    name,
    path: `/bin/${name}`,
    async run(args, opts) {
      calls.push({ args, cwd: opts?.cwd })
      return respond(args, opts)
    },
    async json() {
      throw new Error('unused')
    },
  }
  return { cli, calls }
}

function pushContext(cli: CliRunner) {
  const files = new Map<string, string>()
  const progress: string[] = []
  const ctx: PushContext = {
    cli,
    signal: new AbortController().signal,
    progress: (m) => progress.push(m),
    workDir: '/tmp/work',
    writeFile: async (name, content) => {
      files.set(name, content)
    },
  }
  return { ctx, files, progress }
}

describe('status parsing', () => {
  it('飞书: ready and needs_refresh users are connected; missing app config is reported', () => {
    const ready = parseFeishuStatus({
      appId: 'cli_1',
      identities: { user: { status: 'needs_refresh', available: true, userName: '缪亦隽', openId: 'ou_1' } },
    })
    expect(ready).toMatchObject({ auth: 'authorized', appConfigured: true, account: { name: '缪亦隽' } })
    expect(
      parseFeishuStatus({ ok: false, error: { type: 'config', subtype: 'not_configured', message: 'not configured' } }),
    ).toEqual({ auth: 'unauthorized', appConfigured: false })
    expect(parseFeishuStatus({ appId: 'cli_1', identities: { bot: { status: 'ready' } } })).toMatchObject({
      auth: 'unauthorized',
      appConfigured: true,
    })
    expect(parseFeishuStatus({ appId: 'cli_1', identities: { user: { status: 'expired', userName: 'a' } } }).auth).toBe(
      'expired',
    )
    expect(parseFeishuStatus(undefined, 'boom').auth).toBe('unknown')
  })

  it('钉钉: authenticated payload carries org and user', () => {
    expect(
      parseDingtalkStatus({
        success: true,
        authenticated: true,
        corp_name: '某公司',
        user_name: '张三',
        user_id: 'u1',
      }),
    ).toEqual({ auth: 'authorized', account: { name: '张三', tenant: '某公司', id: 'u1' } })
    expect(parseDingtalkStatus({ success: true, authenticated: false, message: '未登录' })).toEqual({
      auth: 'unauthorized',
      detail: undefined,
    })
    expect(
      parseDingtalkStatus({ success: true, authenticated: false, reason: 'refresh_expired', message: 'Token 已过期' })
        .auth,
    ).toBe('expired')
  })

  it('企业微信: human-readable auth show output', () => {
    expect(parseWecomStatus('Status: authorized\nBot ID: bot_123\n')).toEqual({
      auth: 'authorized',
      account: { id: 'bot_123' },
    })
    expect(parseWecomStatus('Status: unauthorized\n').auth).toBe('unauthorized')
  })
})

describe('钉钉 device flow output (captured from dws 1.0.61)', () => {
  const english = [
    '● Step 1: Requesting device authorization code...',
    '  ╭──────────────────────────────────────────────────────────╮',
    '  │  Please open the following link in your browser and enter the authorization code:  │',
    '  │    link: https://login.dingtalk.com/oauth2/device/verify.htm                       │',
    '  │    authorization code: VQNJ-DFND                                                   │',
    '  │  Or open the following link:                                                       │',
    '  │    https://login.dingtalk.com/oauth2/device/verify.htm?user_code=VQNJ-DFND         │',
    '  │  Authorization code will expire in 900 seconds.                                    │',
    '● Step 2: Waiting for user authorization...',
  ].join('\n')
  const chinese = [
    '  │    链接: https://login.dingtalk.com/oauth2/device/verify.htm                │',
    '  │    授权码: DPMR-XMNP                                                        │',
    '  │    https://login.dingtalk.com/oauth2/device/verify.htm?user_code=DPMR-XMNP  │',
    '  │  授权码将在 900 秒后过期。                                                  │',
  ].join('\n')

  it('reads the code and expiry in both languages', () => {
    expect(parseDeviceOutput(english)).toEqual({ userCode: 'VQNJ-DFND', expiresInSec: 900 })
    expect(parseDeviceOutput(chinese)).toEqual({ userCode: 'DPMR-XMNP', expiresInSec: 900 })
  })

  it('publishes the link with the code filled in, even when the manual page is printed first', async () => {
    const links: AuthLinkInput[] = []
    const hooks: ConnectHooks = {
      signal: new AbortController().signal,
      workDir: '/tmp',
      step: () => {},
      link: async (l) => void links.push(l),
      clearLink: () => {},
    }
    const { cli } = fakeCli('dws', (_args, opts) => {
      opts?.onOutput?.(
        '    link: https://login.dingtalk.com/oauth2/device/verify.htm\n    authorization code: VQNJ-DFND\n',
        'stderr',
      )
      opts?.onOutput?.(
        '    https://login.dingtalk.com/oauth2/device/verify.htm?user_code=VQNJ-DFND\n  Authorization code will expire in 900 seconds.\n',
        'stderr',
      )
      return ok('')
    })
    await runLinkedFlow(cli, ['auth', 'login'], hooks, {
      purpose: 'authorize',
      hostSuffixes: ['dingtalk.com'],
      timeoutMs: 1000,
      prefer: (urls) => urls.find((u) => userCodeInUrl(u)),
      settleMs: 1500,
      userCode: (out, url) => userCodeInUrl(url) ?? parseDeviceOutput(out).userCode,
      expiresInSec: (out) => parseDeviceOutput(out).expiresInSec,
    })
    expect(links).toEqual([
      {
        purpose: 'authorize',
        url: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=VQNJ-DFND',
        userCode: 'VQNJ-DFND',
        expiresInSec: 900,
      },
    ])
  })

  it('falls back to the first acceptable link when the preferred one never appears', async () => {
    const links: AuthLinkInput[] = []
    const hooks: ConnectHooks = {
      signal: new AbortController().signal,
      workDir: '/tmp',
      step: () => {},
      link: async (l) => void links.push(l),
      clearLink: () => {},
    }
    const { cli } = fakeCli('dws', (_args, opts) => {
      opts?.onOutput?.('link: https://login.dingtalk.com/oauth2/device/verify.htm\n', 'stderr')
      return ok('')
    })
    const run = vi.spyOn(cli, 'run').mockImplementation(async (_args, opts) => {
      opts?.onOutput?.('link: https://login.dingtalk.com/oauth2/device/verify.htm\n', 'stderr')
      await new Promise((r) => setTimeout(r, 120))
      return ok('')
    })
    await runLinkedFlow(cli, ['auth', 'login'], hooks, {
      purpose: 'authorize',
      hostSuffixes: ['dingtalk.com'],
      timeoutMs: 1000,
      prefer: (urls) => urls.find((u) => userCodeInUrl(u)),
      settleMs: 50,
    })
    expect(run).toHaveBeenCalled()
    expect(links.map((l) => l.url)).toEqual(['https://login.dingtalk.com/oauth2/device/verify.htm'])
  })
})

describe('command policies', () => {
  it('飞书 read-only detection', () => {
    expect(feishu.isReadOnly(['skills', 'read', 'lark-base'])).toBe(true)
    expect(feishu.isReadOnly(['base', '+record-list', '--base-token', 'b'])).toBe(true)
    expect(feishu.isReadOnly(['mail', 'user_mailbox.messages', 'list'])).toBe(true)
    expect(feishu.isReadOnly(['base', '+record-delete', '--help'])).toBe(true)
    expect(feishu.isReadOnly(['api', 'GET', '/open-apis/x'])).toBe(true)
    expect(feishu.isReadOnly(['base', '+record-batch-create', '--json', '{}'])).toBe(false)
    expect(feishu.isReadOnly(['api', 'POST', '/open-apis/x'])).toBe(false)
    expect(feishu.isReadOnly(['auth', 'login', '--no-wait'])).toBe(false)
  })

  it('飞书 refusals', () => {
    expect(feishu.refusal(['auth', 'logout'])).toMatch(/office_connect/)
    expect(feishu.refusal(['config', 'init', '--new'])).toMatch(/office_connect/)
    expect(feishu.refusal(['base', '+record-delete', '--record-id', 'r'])).toMatch(/删除/)
    expect(feishu.refusal(['api', 'DELETE', '/open-apis/x'])).toMatch(/删除/)
    expect(feishu.refusal(['event', 'consume', 'im.message.receive_v1'])).toBeTruthy()
    expect(feishu.refusal(['base', '+record-batch-update', '--json', '{}'])).toBeUndefined()
  })

  it('钉钉 and 企业微信 policies', () => {
    expect(dingtalk.isReadOnly(['aitable', 'record', 'query', '--base-id', 'b'])).toBe(true)
    expect(dingtalk.isReadOnly(['aitable', 'export', 'data'])).toBe(false)
    expect(dingtalk.isReadOnly(['todo', 'task', 'create', '--title', 'x'])).toBe(false)
    expect(dingtalk.refusal(['aitable', '+record-delete', '--record-ids', 'r'])).toMatch(/删除/)
    expect(dingtalk.refusal(['todo', 'task', 'create', '--title', 'remove-old-bg'])).toBeUndefined()
    expect(dingtalk.refusal(['--profile', 'c1', 'auth', 'logout'])).toBeTruthy()
    expect(dingtalk.isReadOnly(['--profile', 'c1', 'aitable', 'record', 'create'])).toBe(false)
    expect(dingtalk.refusal(['upgrade', '-y'])).toBeTruthy()
    expect(wecom.isReadOnly(['smartsheet', 'sheets', 'list', '--json', '{}'])).toBe(true)
    expect(wecom.isReadOnly(['doc', 'get', '--output', 'x.md'])).toBe(false)
    expect(wecom.isReadOnly(['smartsheet', 'records', 'add', '--json', '{}'])).toBe(false)
    expect(wecom.refusal(['auth', 'init'])).toMatch(/office_connect/)
    expect(wecom.refusal(['smartsheet', 'records', 'delete', '--json', '{}'])).toMatch(/删除/)
  })
})

describe('飞书 table push', () => {
  const table = normalizeTable({
    title: '客户问题汇总',
    columns: [
      { name: '问题' },
      { name: '日期', type: 'date' },
      { name: '状态', type: 'select' },
      { name: '链接', type: 'url' },
    ],
    rows: Array.from({ length: 250 }, (_, i) => ({
      问题: `q${i}`,
      日期: '2026-09-13 10:00',
      状态: i % 2 ? '已回复' : '待处理',
      链接: 'https://example.com',
    })),
  })

  it('creates a Base as the user with the field schema, then writes records in batches of 200 via @file', async () => {
    const { cli, calls } = fakeCli('lark-cli', (args) => {
      if (args[1] === '+base-create')
        return ok(
          JSON.stringify({
            ok: true,
            identity: 'user',
            data: {
              base: { base_token: 'basX', url: 'https://t.feishu.cn/base/basX' },
              table: { id: 'tblY', name: '数据' },
              created: true,
            },
          }),
        )
      return ok(JSON.stringify({ ok: true, data: { records: [] } }))
    })
    const { ctx, files } = pushContext(cli)
    const outcome = await feishu.createTable(ctx, table)

    const create = calls[0]!.args
    expect(create.slice(0, 4)).toEqual(['base', '+base-create', '--as', 'user'])
    const fields = JSON.parse(create[create.indexOf('--fields') + 1] as string)
    expect(fields).toEqual([
      { type: 'text', name: '问题' },
      { type: 'datetime', name: '日期' },
      { type: 'select', name: '状态', multiple: false, options: [{ name: '待处理' }, { name: '已回复' }] },
      { type: 'text', name: '链接', style: { type: 'url' } },
    ])
    expect(calls.filter((c) => c.args[1] === '+record-batch-create')).toHaveLength(2)
    expect(calls[1]!.args).toContain('@records-0.json')
    expect(calls[1]!.cwd).toBe('/tmp/work')
    const firstBatch = JSON.parse(files.get('records-0.json') as string)
    expect(firstBatch.create_records).toHaveLength(200)
    expect(firstBatch.create_records[0]).toEqual({
      问题: 'q0',
      日期: '2026-09-13 10:00',
      状态: ['待处理'],
      链接: 'https://example.com',
    })
    expect(outcome).toMatchObject({
      url: 'https://t.feishu.cn/base/basX?table=tblY',
      rowsWritten: 250,
      target: { baseToken: 'basX', tableId: 'tblY' },
      mode: 'create',
    })
  })

  it('appends to a Base URL, adding only the missing fields', async () => {
    const { cli, calls } = fakeCli('lark-cli', (args) => {
      if (args[1] === '+field-list')
        return ok(
          JSON.stringify({
            ok: true,
            data: {
              fields: [
                { id: 'f1', name: '问题' },
                { id: 'f2', name: '日期' },
              ],
            },
          }),
        )
      return ok(JSON.stringify({ ok: true, data: {} }))
    })
    const { ctx } = pushContext(cli)
    const outcome = await feishu.appendTable(ctx, table, { url: 'https://t.feishu.cn/base/basX?table=tblY&view=vew1' })
    const created = calls.find((c) => c.args[1] === '+field-create')
    expect(
      JSON.parse(created!.args[created!.args.indexOf('--json') + 1] as string).map((f: { name: string }) => f.name),
    ).toEqual(['状态', '链接'])
    expect(outcome).toMatchObject({ mode: 'append', rowsWritten: 250, target: { baseToken: 'basX', tableId: 'tblY' } })
    expect(outcome.warnings.join('\n')).toMatch(/新增了字段/)
  })

  it('surfaces permission problems as not_connected', async () => {
    const { cli } = fakeCli('lark-cli', () => ({
      code: 1,
      stdout: '',
      stderr: JSON.stringify({ ok: false, error: { type: 'auth', message: 'missing scope base:app:create' } }),
      timedOut: false,
      aborted: false,
    }))
    const { ctx } = pushContext(cli)
    await expect(feishu.createTable(ctx, table)).rejects.toMatchObject({ code: 'not_connected' })
  })
})

describe('钉钉 and 企业微信 table push', () => {
  const table = normalizeTable({
    title: '周报',
    columns: [
      { name: '事项' },
      { name: '完成', type: 'checkbox' },
      { name: '标签', type: 'multi_select' },
      { name: '链接', type: 'url' },
    ],
    rows: [{ 事项: 'a', 完成: true, 标签: ['x', 'y'], 链接: 'https://example.com' }],
  })

  it('钉钉: bootstraps the base, maps field names to ids, writes cells by fieldId', async () => {
    const { cli, calls } = fakeCli('dws', (args) => {
      if (args[1] === '+base-bootstrap')
        return ok(
          JSON.stringify({ status: 'completed', result: { baseId: 'B1', tables: [{ tableId: 'T1', name: '数据' }] } }),
        )
      if (args[1] === 'field' && args[2] === 'list')
        return ok(
          JSON.stringify({
            result: {
              fields: [
                { fieldId: 'fA', fieldName: '事项' },
                { fieldId: 'fB', fieldName: '完成' },
                { fieldId: 'fC', fieldName: '标签' },
                { fieldId: 'fD', fieldName: '链接' },
              ],
            },
          }),
        )
      return ok(JSON.stringify({ result: { newRecordIds: ['r1'] } }))
    })
    const { ctx, files } = pushContext(cli)
    const outcome = await dingtalk.createTable(ctx, table)
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--format', 'json', '--yes']))
    expect(JSON.parse(files.get('records-0.json') as string)).toEqual([
      {
        cells: { fA: 'a', fB: true, fC: ['x', 'y'], fD: { text: 'https://example.com', link: 'https://example.com' } },
      },
    ])
    expect(outcome.url).toBe('https://alidocs.dingtalk.com/i/nodes/B1?iframeQuery=sheetId%3DT1')
  })

  it('企业微信: creates the smartsheet with fields and writes selects as text', async () => {
    const { cli, calls } = fakeCli('wecom-cli', (args) => {
      if (args[1] === 'create')
        return ok(JSON.stringify({ errcode: 0, url: 'https://doc.weixin.qq.com/smartsheet/s3_x', docid: 's3_x' }))
      return ok(JSON.stringify({ errcode: 0, records: [] }))
    })
    const { ctx } = pushContext(cli)
    const outcome = await wecom.createTable(ctx, table)
    const body = JSON.parse(calls[0]!.args[3] as string)
    expect(body.fields).toEqual([
      { field_title: '事项', field_type: 'text' },
      { field_title: '完成', field_type: 'checkbox' },
      { field_title: '标签', field_type: 'text' },
      { field_title: '链接', field_type: 'url' },
    ])
    const add = calls[1]!.args
    const records = JSON.parse(add[add.indexOf('--json') + 1] as string).records
    expect(records[0].values).toEqual({
      事项: 'a',
      完成: true,
      标签: 'x、y',
      链接: [{ text: 'https://example.com', link: 'https://example.com' }],
    })
    expect(outcome.warnings.join('\n')).toMatch(/按文本写入/)
  })

  it('企业微信: 851003 becomes an explanation instead of a raw code', async () => {
    const { cli } = fakeCli('wecom-cli', (args) =>
      args[1] === 'create'
        ? ok(JSON.stringify({ errcode: 0, docid: 's3_x' }))
        : {
            code: 1,
            stdout: JSON.stringify({ errcode: 851003, errmsg: 'no authority' }),
            stderr: '',
            timedOut: false,
            aborted: false,
          },
    )
    const { ctx } = pushContext(cli)
    await expect(wecom.createTable(ctx, table)).rejects.toThrow(/可见范围超过 10 人/)
  })
})
