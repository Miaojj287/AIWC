import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { McpServerConfigSchema, type McpServerConfig, type McpServerStatus, type ToolContext } from '@aiwc/protocol'
import { createToolRegistry } from '@aiwc/kernel'
import { nullLogger } from '../../log'
import { createMcpManager, type McpManager } from './manager'
import { FAKE_STDIO_SERVER } from './testing/fakeServer'

const server = (patch: Partial<McpServerConfig> = {}): McpServerConfig =>
  McpServerConfigSchema.parse({
    id: 'fake',
    label: 'Fake',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', FAKE_STDIO_SERVER],
    secrets: [{ name: 'FAKE_TOKEN', ref: 'mcp.fake.FAKE_TOKEN' }],
    timeoutMs: 5_000,
    ...patch,
  })

const ctx = (signal = new AbortController().signal): ToolContext =>
  ({ signal, progress: () => undefined }) as unknown as ToolContext

function setup(configs: McpServerConfig[], secretValues: Record<string, string> = { 'mcp.fake.FAKE_TOKEN': 's3cret' }) {
  const registry = createToolRegistry()
  const statuses: McpServerStatus[] = []
  let list = configs
  const manager = createMcpManager({
    store: { listMcp: () => list, getMcp: (id) => list.find((s) => s.id === id) },
    secrets: { reveal: (ref) => secretValues[ref] ?? null },
    registry,
    cliEnv: async () => ({ env: { PATH: process.env.PATH }, which: async () => undefined }),
    clientVersion: 'test',
    onStatus: (s) => statuses.push(s),
    logger: nullLogger,
  })
  managers.push(manager)
  return { registry, statuses, manager, setList: (next: McpServerConfig[]) => (list = next) }
}

const managers: McpManager[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.shutdown()))
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

describe('MCP manager over stdio', () => {
  it('connects, registers namespaced tools with the user risk, and calls them with secret env', async () => {
    const { registry, manager } = setup([server()])
    await manager.start()
    const status = manager.status('fake')
    expect(status.state).toBe('ready')
    expect(status.serverName).toBe('fake')
    const names = registry.list().map((t) => t.name)
    expect(names).toContain('mcp__fake__echo')
    const destructive = status.tools.find((t) => t.name === 'Delete-All')!
    expect(destructive.toolName).toMatch(/^mcp__fake__delete_all_[0-9a-f]{4}$/)
    expect(destructive.risk).toBe('destructive')
    // readOnlyHint never lowers the default
    expect(registry.get('mcp__fake__echo')!.risk).toBe('write')
    expect(registry.get('mcp__fake__echo')!.offDevice).toBe(false)
    const result = await registry.get('mcp__fake__echo')!.execute({ text: 'hi' }, ctx())
    expect(result).toEqual({ content: 'echo:hi:s3cret', isError: false })
  })

  it('honours per-tool overrides and disabled tools without reconnecting', async () => {
    const base = server()
    const { registry, manager, setList } = setup([base])
    await manager.start()
    setList([{ ...base, toolRisk: { echo: 'read' }, disabledTools: ['slow'] }])
    const status = manager.reapplyTools('fake')
    expect(registry.get('mcp__fake__echo')!.risk).toBe('read')
    expect(registry.get('mcp__fake__echo')!.profiles).toContain('subagent')
    expect(registry.get('mcp__fake__slow')).toBeUndefined()
    expect(status.tools.find((t) => t.name === 'slow')!.disabled).toBe(true)
  })

  it('cancels a call when the signal aborts', async () => {
    const { registry, manager } = setup([server({ timeoutMs: 5_000 })])
    await manager.start()
    const controller = new AbortController()
    const pending = registry.get('mcp__fake__slow')!.execute({}, ctx(controller.signal))
    controller.abort()
    await expect(pending).rejects.toThrow()
  })

  it('a crashed server goes to error with its stderr and loses its tools', async () => {
    const { registry, manager, statuses } = setup([server()])
    await manager.start()
    await expect(registry.get('mcp__fake__crash')!.execute({}, ctx())).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 50))
    expect(manager.status('fake')).toMatchObject({ state: 'error', errorCode: 'exited' })
    expect(statuses.at(-1)?.error).toContain('boom')
    expect(registry.list().filter((t) => t.name.startsWith('mcp__fake__'))).toEqual([])
  })

  it('re-lists tools on list_changed', async () => {
    const { registry, manager } = setup([server()])
    await manager.start()
    await registry.get('mcp__fake__grow')!.execute({}, ctx())
    await new Promise((r) => setTimeout(r, 800))
    expect(registry.get('mcp__fake__later')).toBeDefined()
  })

  it('reports a missing secret and a command that does not exist', async () => {
    const missing = setup([server()], {})
    await missing.manager.start()
    expect(missing.manager.status('fake')).toMatchObject({ state: 'error', errorCode: 'missing_secret' })
    const bad = setup([server({ id: 'bad', command: '/nonexistent/mcp-server', secrets: [] })])
    await bad.manager.start()
    expect(bad.manager.status('bad')).toMatchObject({ state: 'error', errorCode: 'spawn_failed' })
  })

  it('a disabled server stays down and a dropped one releases its tools', async () => {
    const off = setup([server({ enabled: false })])
    await off.manager.start()
    expect(off.manager.status('fake').state).toBe('disabled')
    expect(off.registry.list()).toEqual([])
    const on = setup([server()])
    await on.manager.start()
    await on.manager.drop('fake')
    expect(on.registry.list()).toEqual([])
    expect(on.manager.status('fake').state).toBe('disabled')
  })
})

describe('MCP manager over Streamable HTTP', () => {
  it('handshakes with a session id, reads JSON and SSE responses, and marks tools off-device', async () => {
    const seen: Array<{ session?: string; auth?: string; version?: string }> = []
    const http = createServer((req, res) => {
      if (req.method === 'DELETE') return void res.writeHead(204).end()
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const msg = JSON.parse(body) as { id?: number; method: string; params?: { arguments?: { text?: string } } }
        seen.push({
          session: req.headers['mcp-session-id'] as string | undefined,
          auth: req.headers.authorization,
          version: req.headers['mcp-protocol-version'] as string | undefined,
        })
        if (msg.id === undefined) return void res.writeHead(202).end()
        const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
        if (msg.method === 'initialize') {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' })
          return void res.end(JSON.stringify(reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'web' } })))
        }
        if (msg.method === 'tools/list') {
          res.writeHead(200, { 'content-type': 'application/json' })
          return void res.end(JSON.stringify(reply({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] })))
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `event: message\ndata: ${JSON.stringify(reply({ content: [{ type: 'text', text: `web:${msg.params?.arguments?.text}` }] }))}\n\n`,
        )
        res.end()
      })
    })
    servers.push(http)
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
    const port = (http.address() as AddressInfo).port
    const config = McpServerConfigSchema.parse({
      id: 'web',
      label: 'Web',
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
      secrets: [{ name: 'Authorization', ref: 'mcp.web.Authorization' }],
    })
    const { registry, manager } = setup([config], { 'mcp.web.Authorization': 'Bearer t0k' })
    await manager.start()
    expect(manager.status('web').state).toBe('ready')
    const tool = registry.get('mcp__web__echo')!
    expect(tool.offDevice).toBe(true)
    expect(await tool.execute({ text: 'x' }, ctx())).toEqual({ content: 'web:x', isError: false })
    expect(seen[0]).toMatchObject({ session: undefined, auth: 'Bearer t0k' })
    expect(seen.at(-1)).toMatchObject({ session: 'sess-1', version: '2025-06-18' })
  })
})
