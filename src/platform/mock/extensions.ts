/**
 * mcp:* / hooks:* for the mock bridge (tests + browser previews): servers "connect" after a short delay and offer a
 * few demo tools; hooks save and test-run without running anything. Nothing here is used by the desktop app.
 */
import {
  McpServerDraftSchema,
  UserHookDraftSchema,
  type McpServerStatus,
  type McpServerView,
  type McpToolView,
  type UserHookView,
} from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const SERVERS_KEY = 'aiwc.mock.mcpServers'
const HOOKS_KEY = 'aiwc.mock.hooks'
const CONNECT_MS = 600

const DEMO_TOOLS: ReadonlyArray<
  Pick<McpToolView, 'name' | 'description' | 'declaredReadOnly' | 'declaredDestructive'>
> = [
  { name: 'read_file', description: 'Read a file', declaredReadOnly: true },
  { name: 'write_file', description: 'Write a file' },
  { name: 'delete_file', description: 'Delete a file', declaredDestructive: true },
]

type Stored = Omit<McpServerView, 'status'>

export function extensionsHandlers(ctx: MockContext): HandlersFor<'mcp'> & HandlersFor<'hooks'> {
  const servers = new Map<string, Stored>(Object.entries(ctx.kv.get<Record<string, Stored>>(SERVERS_KEY, {})))
  const hooks = new Map<string, UserHookView>(Object.entries(ctx.kv.get<Record<string, UserHookView>>(HOOKS_KEY, {})))
  const statuses = new Map<string, McpServerStatus>()
  const persist = () => {
    ctx.kv.set(SERVERS_KEY, Object.fromEntries(servers))
    ctx.kv.set(HOOKS_KEY, Object.fromEntries(hooks))
  }

  const toolsOf = (server: Stored): McpToolView[] =>
    DEMO_TOOLS.map((tool) => ({
      ...tool,
      toolName: `mcp__${server.id}__${tool.name}`,
      risk:
        tool.declaredDestructive && !tool.declaredReadOnly
          ? 'destructive'
          : (server.toolRisk[tool.name] ?? server.defaultRisk),
      ...(server.toolRisk[tool.name] ? { override: server.toolRisk[tool.name] } : {}),
      disabled: server.disabledTools.includes(tool.name),
    }))
  const statusOf = (server: Stored): McpServerStatus =>
    statuses.get(server.id) ?? {
      id: server.id,
      state: server.enabled ? 'connecting' : 'disabled',
      tools: [],
      updatedAt: ctx.now(),
    }
  const view = (server: Stored): McpServerView => ({ ...server, status: statusOf(server) })
  const publish = (status: McpServerStatus) => {
    statuses.set(status.id, status)
    ctx.emit('mcp:status', status)
  }
  const connect = async (id: string): Promise<McpServerStatus> => {
    const server = servers.get(id)
    if (!server) return { id, state: 'disabled', tools: [], updatedAt: ctx.now() }
    if (!server.enabled) {
      publish({ id, state: 'disabled', tools: [], updatedAt: ctx.now() })
      return statusOf(server)
    }
    publish({ id, state: 'connecting', tools: [], updatedAt: ctx.now() })
    await ctx.delay(CONNECT_MS)
    const status: McpServerStatus = {
      id,
      state: 'ready',
      serverName: server.label,
      serverVersion: '1.0.0',
      tools: toolsOf(server),
      updatedAt: ctx.now(),
    }
    publish(status)
    return status
  }
  for (const id of servers.keys()) void connect(id)

  const requireServer = (id: string): Stored => {
    const server = servers.get(id)
    if (!server) throw new Error(`unknown MCP server: ${id}`)
    return server
  }
  const requireHook = (id: string): UserHookView => {
    const hook = hooks.get(id)
    if (!hook) throw new Error(`unknown hook: ${id}`)
    return hook
  }

  return {
    'mcp:list': () => [...servers.values()].map(view),
    'mcp:save': (raw) => {
      const draft = McpServerDraftSchema.parse(raw)
      const previous = servers.get(draft.originalId ?? draft.id)
      if (draft.originalId && draft.originalId !== draft.id) servers.delete(draft.originalId)
      const { originalId: _originalId, secrets, ...rest } = draft
      const stored: Stored = {
        ...rest,
        secrets: secrets.map((s) => ({
          name: s.name,
          hasValue: Boolean(s.value) || Boolean(previous?.secrets.find((p) => p.name === s.name)?.hasValue),
        })),
      }
      servers.set(stored.id, stored)
      statuses.delete(stored.id)
      persist()
      void connect(stored.id)
      return { ok: true, value: view(stored) }
    },
    'mcp:remove': ({ id }) => {
      servers.delete(id)
      statuses.delete(id)
      persist()
    },
    'mcp:setEnabled': ({ id, enabled }) => {
      const server = { ...requireServer(id), enabled }
      servers.set(id, server)
      statuses.delete(id)
      persist()
      void connect(id)
      return view(server)
    },
    'mcp:restart': async ({ id }) => {
      const server = requireServer(id)
      await connect(id)
      return view(server)
    },
    'mcp:setToolPolicy': ({ id, tool, risk, disabled }) => {
      const server = requireServer(id)
      const toolRisk = { ...server.toolRisk }
      if (risk === null) delete toolRisk[tool]
      else if (risk) toolRisk[tool] = risk
      const disabledTools =
        disabled === undefined
          ? server.disabledTools
          : disabled
            ? [...new Set([...server.disabledTools, tool])]
            : server.disabledTools.filter((name) => name !== tool)
      const next = { ...server, toolRisk, disabledTools }
      servers.set(id, next)
      persist()
      const status = statuses.get(id)
      if (status?.state === 'ready') publish({ ...status, tools: toolsOf(next), updatedAt: ctx.now() })
      return view(next)
    },
    'hooks:list': () => ({ hooks: [...hooks.values()], sandbox: ctx.platform === 'darwin' }),
    'hooks:save': (raw) => {
      const draft = UserHookDraftSchema.parse(raw)
      const hook: UserHookView = { ...draft, id: draft.id ?? ctx.id('hk_mock') }
      hooks.set(hook.id, hook)
      persist()
      return { ok: true, value: hook }
    },
    'hooks:remove': ({ id }) => {
      hooks.delete(id)
      persist()
    },
    'hooks:setEnabled': ({ id, enabled }) => {
      const hook = { ...requireHook(id), enabled }
      hooks.set(id, hook)
      persist()
      return hook
    },
    'hooks:test': async ({ id }) => {
      const hook = requireHook(id)
      await ctx.delay(300)
      const lastRun = { at: ctx.now(), outcome: 'allowed' as const, exitCode: 0, durationMs: 42 }
      hooks.set(id, { ...hook, lastRun })
      persist()
      return { ...lastRun, stdout: '', stderr: '' }
    },
  }
}
