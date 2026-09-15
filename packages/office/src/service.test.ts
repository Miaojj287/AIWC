import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OfficeConnectSession, ToolContext } from '@aiwc/protocol'
import type { CliEnv } from '@aiwc/shell'

import { OfficeError } from './cli/runner'
import { feishu } from './platforms/feishu'
import type { PlatformModule } from './platforms/types'
import { createOfficeService } from './service'
import { officeTools } from './tools/officeTools'

/** CLI env whose `which` finds only the given binaries; every process run goes through `run`. */
function fakeEnv(found: string[]): CliEnv {
  return {
    path: '/fake/bin',
    env: { PATH: '/fake/bin' },
    which: async (name) => (found.includes(name) ? process.execPath : undefined),
  }
}

/** A module around feishu's spec whose flows are scripted by the test. */
function scriptedModule(overrides: Partial<PlatformModule>): PlatformModule {
  return { ...feishu, ...overrides }
}

async function service(
  modules: Partial<Record<'feishu' | 'dingtalk' | 'wecom', PlatformModule>>,
  opts: { openExternal?: (url: string) => Promise<void> } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), 'aiwc-office-svc-'))
  const openExternal = vi.fn(opts.openExternal ?? (async () => {}))
  // Every "CLI" resolves to node, so `--version` and friends run for real without any vendor binary.
  const svc = createOfficeService({
    dataDir,
    openExternal,
    cliEnv: fakeEnv(['lark-cli', 'dws', 'wecom-cli']),
    modules,
    renderQr: async (t) => `data:image/png;base64,${Buffer.from(t).toString('base64')}`,
  })
  return { svc, openExternal, dataDir }
}

function toolCtx(signal = new AbortController().signal): ToolContext & { progressLog: string[] } {
  const progressLog: string[] = []
  return {
    threadId: 't1' as ToolContext['threadId'],
    turnId: 'u1' as ToolContext['turnId'],
    stepId: 's1' as ToolContext['stepId'],
    callId: 'call_1' as ToolContext['callId'],
    channel: 'desktop',
    profile: 'desktop-chat',
    signal,
    services: {},
    progress: (m) => progressLog.push(m),
    depth: 0,
    progressLog,
  }
}

describe('connect sessions', () => {
  it('publishes steps and a validated link (QR + browser), then finishes with the fresh status', async () => {
    let authorized = false
    let release!: () => void
    const granted = new Promise<void>((r) => (release = r))
    const module = scriptedModule({
      probe: async () =>
        authorized
          ? { auth: 'authorized', account: { name: '缪亦隽' }, appConfigured: true }
          : { auth: 'unauthorized', appConfigured: true },
      connect: async (_cli, hooks) => {
        hooks.step('app', 'done')
        hooks.step('authorize', 'running')
        await hooks.link({
          purpose: 'authorize',
          url: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=AB-12',
          userCode: 'AB-12',
          expiresInSec: 600,
        })
        await granted
        authorized = true
        hooks.clearLink()
        hooks.step('authorize', 'done')
        hooks.step('verify', 'done', '缪亦隽')
      },
    })
    const { svc, openExternal } = await service({ feishu: module })
    const seen: OfficeConnectSession[] = []
    svc.onSession((s) => seen.push(s))

    const { session, done } = svc.connect({ platform: 'feishu', callId: 'call_9' })
    expect(session.callId).toBe('call_9')
    await vi.waitFor(() => expect(seen.at(-1)?.state).toBe('waiting'))
    const waiting = seen.at(-1)!
    expect(waiting.link).toMatchObject({ purpose: 'authorize', userCode: 'AB-12', opened: true })
    expect(waiting.link?.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(openExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify?user_code=AB-12')
    // A second connect for the same platform joins the running session.
    expect(svc.connect({ platform: 'feishu' }).session.id).toBe(session.id)

    release()
    const final = await done
    expect(final.state).toBe('done')
    expect(final.link).toBeUndefined()
    expect(final.status).toMatchObject({ auth: 'authorized', account: { name: '缪亦隽' } })
    expect(final.steps.find((s) => s.id === 'install')?.state).toBe('done')
  })

  it('never opens a link on a foreign host', async () => {
    const module = scriptedModule({
      probe: async () => ({ auth: 'authorized' }),
      connect: async (_cli, hooks) => {
        await hooks.link({ purpose: 'authorize', url: 'https://evil.example.com/login' })
      },
    })
    const { svc, openExternal } = await service({ feishu: module })
    await svc.connect({ platform: 'feishu' }).done
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('cancel aborts the flow and marks the session cancelled', async () => {
    const module = scriptedModule({
      probe: async () => ({ auth: 'unauthorized' }),
      connect: (_cli, hooks) =>
        new Promise((_, reject) => {
          hooks.signal.addEventListener('abort', () => reject(new OfficeError('cancelled', '已取消')))
        }),
    })
    const { svc } = await service({ feishu: module })
    const { session, done } = svc.connect({ platform: 'feishu' })
    expect(svc.cancel(session.id)).toBe(true)
    expect((await done).state).toBe('cancelled')
    expect(svc.cancel(session.id)).toBe(false)
  })

  it('office_connect cancels its own session when the turn is interrupted, and reports failure to the model', async () => {
    const module = scriptedModule({
      probe: async () => ({ auth: 'unauthorized' }),
      connect: (_cli, hooks) =>
        new Promise((_, reject) => {
          hooks.signal.addEventListener('abort', () => reject(new OfficeError('cancelled', '已取消')))
        }),
    })
    const { svc } = await service({ feishu: module })
    const tool = officeTools(svc).find((t) => t.name === 'office_connect')!
    const controller = new AbortController()
    const ctx = toolCtx(controller.signal)
    const pending = tool.execute({ platform: 'feishu' }, ctx)
    await vi.waitFor(() => expect(svc.sessions()).toHaveLength(1))
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toMatchObject({ connected: false, code: 'cancelled' })
  })

  it.skipIf(process.platform === 'win32')(
    'installs a missing CLI into the private prefix with a sandboxed HOME, then connects',
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'aiwc-office-svc-'))
      const tools = await mkdtemp(join(tmpdir(), 'aiwc-office-npm-'))
      const binDir = join(dataDir, 'cli', 'node_modules', '.bin')
      // Fake npm: records the environment the postinstall would see, then "installs" a wecom-cli that is already bound.
      const npm = join(tools, 'npm')
      await writeFile(
        npm,
        [
          '#!/bin/sh',
          'prefix=""; while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done',
          'printf "%s\\n%s\\n" "$HOME" "$npm_config_userconfig" > "$prefix/env.txt"',
          'mkdir -p "$prefix/node_modules/.bin"',
          `cat > "$prefix/node_modules/.bin/wecom-cli" <<'EOF'`,
          '#!/bin/sh',
          'if [ "$1" = "--version" ]; then echo "wecom-cli 0.3.1"; exit 0; fi',
          'if [ "$1" = "auth" ] && [ "$2" = "show" ]; then printf "Status: authorized\\nBot ID: bot_42\\n"; exit 0; fi',
          'exit 2',
          'EOF',
          'chmod +x "$prefix/node_modules/.bin/wecom-cli"',
        ].join('\n'),
      )
      await chmod(npm, 0o755)
      const env: CliEnv = {
        path: `${binDir}:/usr/bin:/bin`,
        env: { PATH: `${binDir}:/usr/bin:/bin` },
        which: async (name) => (name === 'npm' ? npm : existsSync(join(binDir, name)) ? join(binDir, name) : undefined),
      }
      const svc = createOfficeService({
        dataDir,
        openExternal: async () => {},
        cliEnv: env,
        env: { HOME: '/Users/someone', PATH: '/usr/bin' },
      })
      const final = await svc.connect({ platform: 'wecom' }).done
      expect(final.state).toBe('done')
      expect(final.steps.find((s) => s.id === 'install')).toMatchObject({ state: 'done', detail: 'wecom-cli 0.3.1' })
      expect(final.status).toMatchObject({ installed: true, auth: 'authorized', account: { id: 'bot_42' } })
      const [home, userconfig] = readFileSync(join(dataDir, 'cli', 'env.txt'), 'utf8')
        .trim()
        .split('\n')
      expect(home).toBe(join(dataDir, 'cli', 'home'))
      expect(userconfig).toBe('/Users/someone/.npmrc')
    },
  )

  it('reports a missing CLI with the install command when npm is unavailable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'aiwc-office-svc-'))
    const svc = createOfficeService({ dataDir, openExternal: async () => {}, cliEnv: fakeEnv([]) })
    const final = await svc.connect({ platform: 'wecom' }).done
    expect(final.state).toBe('failed')
    expect(final.error).toMatchObject({ code: 'cli_missing', command: 'npm install -g @wecom/cli' })
    expect(final.steps[0]).toMatchObject({ id: 'install', state: 'failed' })
  })
})

describe('pushTable', () => {
  const columns = [{ name: '事项' }, { name: '数量', type: 'number' as const }]

  it('refuses when the platform is not authorized', async () => {
    const { svc } = await service({ feishu: scriptedModule({ probe: async () => ({ auth: 'expired' }) }) })
    await expect(
      svc.pushTable(
        { platform: 'feishu', title: 't', columns, rows: [{ 事项: 'a' }] },
        { signal: new AbortController().signal, progress: () => {} },
      ),
    ).rejects.toMatchObject({
      code: 'not_connected',
      message: expect.stringMatching(/过期/),
    })
  })

  it('records the push and lets a later push append by pushId', async () => {
    const createTable = vi.fn<PlatformModule['createTable']>(async (ctx, table) => {
      await ctx.writeFile('payload.json', '{}')
      return {
        url: 'https://t.feishu.cn/base/basX?table=tblY',
        title: table.title,
        mode: 'create',
        rowsWritten: table.rows.length,
        target: { baseToken: 'basX', tableId: 'tblY' },
        warnings: [],
      }
    })
    const appendTable = vi.fn<PlatformModule['appendTable']>(async (_ctx, table, target) => ({
      url: target.url,
      title: table.title,
      mode: 'append',
      rowsWritten: table.rows.length,
      target: target.coords ?? {},
      warnings: [],
    }))
    const { svc } = await service({
      feishu: scriptedModule({ probe: async () => ({ auth: 'authorized' }), createTable, appendTable }),
    })
    const ctx = { signal: new AbortController().signal, progress: () => {} }

    const first = await svc.pushTable(
      {
        platform: 'feishu',
        title: '问题汇总',
        columns,
        rows: [
          { 事项: 'a', 数量: 1 },
          { 事项: 'b', 数量: '2' },
        ],
      },
      ctx,
    )
    expect(first.record).toMatchObject({ platform: 'feishu', rows: 2, mode: 'create', columns: ['事项', '数量'] })
    const recent = await svc.recentPushes()
    expect(recent[0]?.id).toBe(first.record.id)

    await svc.pushTable(
      { platform: 'feishu', title: '问题汇总', columns, rows: [{ 事项: 'c' }], target: { pushId: first.record.id } },
      ctx,
    )
    expect(appendTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ coords: { baseToken: 'basX', tableId: 'tblY' } }),
    )
    await expect(
      svc.pushTable({ platform: 'dingtalk', title: 'x', columns, rows: [], target: { pushId: first.record.id } }, ctx),
    ).rejects.toThrow(/属于飞书/)
    await expect(
      svc.pushTable(
        { platform: 'feishu', title: 'x', columns, rows: [], target: { url: 'https://example.com/base/x' } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('office_push_table returns the link and pushId, or a structured error', async () => {
    const { svc } = await service({
      feishu: scriptedModule({
        probe: async () => ({ auth: 'authorized' }),
        createTable: async (_ctx, table) => ({
          url: 'https://t.feishu.cn/base/b',
          title: table.title,
          mode: 'create',
          rowsWritten: 1,
          target: {},
          warnings: ['第一列…'],
        }),
      }),
    })
    const tool = officeTools(svc).find((t) => t.name === 'office_push_table')!
    expect(tool.risk).toBe('send')
    expect(tool.profiles).toEqual(['desktop-chat'])
    expect(tool.summarize?.({ platform: 'feishu', title: '周报', columns, rows: [{ 事项: 'a' }] })).toBe(
      '推送 1 行 × 2 列到飞书多维表格「周报」',
    )
    const ok = await tool.execute({ platform: 'feishu', title: '周报', columns, rows: [{ 事项: 'a' }] }, toolCtx())
    expect(ok.content).toMatchObject({ ok: true, url: 'https://t.feishu.cn/base/b', rows: 1, warnings: ['第一列…'] })
    const bad = await tool.execute(
      { platform: 'feishu', title: '周报', columns: [{ name: 'a' }, { name: 'a' }], rows: [] },
      toolCtx(),
    )
    expect(bad).toMatchObject({ isError: true, content: { ok: false, code: 'invalid_input' } })
  })
})

describe('commandClassifier (for the shell tool)', () => {
  it('grades vendor CLI command lines by verb and leaves other programs alone', async () => {
    const { svc } = await service({})
    const classify = svc.commandClassifier()
    expect(classify(['lark-cli', 'base', '+table-list', '--base-token', 'b'])).toMatchObject({ risk: 'read', allowKey: 'lark-cli base +table-list' })
    expect(classify(['/usr/local/bin/lark-cli', 'skills', 'read', 'lark-base'])).toMatchObject({ risk: 'read' })
    expect(classify(['lark-cli', 'base', '+record-batch-create', '--json', '@x'])).toMatchObject({ risk: 'write', allowKey: 'lark-cli base +record-batch-create' })
    expect(classify(['lark-cli', 'auth', 'logout'])).toMatchObject({ risk: 'destructive' })
    expect(classify(['dws', 'aitable', '+record-delete', '--record-ids', 'r'])).toMatchObject({ risk: 'destructive' })
    expect(classify(['dws', 'aitable', 'record', 'query', '--base-id', 'b'])).toMatchObject({ risk: 'read' })
    expect(classify(['wecom-cli', 'smartsheet', 'records', 'add', '--json', '{}'])).toMatchObject({ risk: 'write' })
    expect(classify(['git', 'status'])).toBeUndefined()
    expect(svc.writableRoots().some((r) => r.endsWith('.lark-cli'))).toBe(true)
  })
})
