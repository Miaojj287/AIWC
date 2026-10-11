// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerView, UserHookView } from '@aiwc/protocol'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { ExtensionsPage } from './ExtensionsPage'
import { McpToolsDialog } from './extensions/McpToolsDialog'

const { invokeMock, data } = vi.hoisted(() => ({
  invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>(),
  data: { servers: [] as unknown[], hooks: [] as unknown[] },
}))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: (channel: string) => ({
    data: channel === 'mcp:list' ? data.servers : { hooks: data.hooks, sandbox: true },
    error: undefined,
    loading: false,
    reload: () => {},
  }),
}))

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const server: McpServerView = {
  id: 'files',
  label: 'Files',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'fs-server'],
  url: '',
  defaultRisk: 'write',
  toolRisk: {},
  disabledTools: [],
  timeoutMs: 120_000,
  secrets: [],
  status: { id: 'files', state: 'error', errorCode: 'exited', error: 'boom', tools: [], updatedAt: 1 },
}
const hook: UserHookView = {
  id: 'hk_abcdef',
  label: '',
  enabled: true,
  event: 'PreToolUse',
  matcher: 'shell',
  command: './guard.sh',
  timeoutMs: 60_000,
  sandbox: true,
  lastRun: { at: Date.now(), outcome: 'blocked', exitCode: 2, durationMs: 5, message: 'no rm' },
}

beforeEach(() => {
  invokeMock.mockReset()
  data.servers = []
  data.hooks = []
})
afterEach(() => {
  cleanup()
  __resetLanguageForTests()
})

describe('ExtensionsPage', () => {
  it('shows both empty states without a standing data-flow note', () => {
    render(<ExtensionsPage />)
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByText('还没有 MCP 服务器')).toBeTruthy()
    expect(screen.getByText('还没有 Hook')).toBeTruthy()
  })

  it('lists a failing server with its reason and a hook with its last run', () => {
    data.servers = [server]
    data.hooks = [hook]
    render(<ExtensionsPage />)
    expect(screen.getByText('连接失败')).toBeTruthy()
    expect(screen.getByText(/服务器已退出：boom/)).toBeTruthy()
    expect(screen.getByText('调用工具前')).toBeTruthy()
    expect(screen.getByText('匹配 shell')).toBeTruthy()
    expect(screen.getByText(/上次运行：已拦截/)).toBeTruthy()
  })

  it('adds a server: inline errors first, then a draft with one argument per line', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { ...server, id: 'github', label: 'GitHub' } })
    render(<ExtensionsPage />)
    fireEvent.click(screen.getAllByRole('button', { name: '添加服务器' })[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText('请填写名称')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'GitHub' } })
    fireEvent.change(within(dialog).getByLabelText('命令'), { target: { value: 'npx' } })
    fireEvent.change(within(dialog).getByLabelText('参数'), { target: { value: '-y\n@mcp/github\n' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('mcp:save', expect.objectContaining({ id: 'github' })))
    expect(invokeMock.mock.calls[0]![1]).toMatchObject({
      command: 'npx',
      args: ['-y', '@mcp/github'],
      transport: 'stdio',
    })
  })

  it('reads in English', () => {
    setLanguage('en-US')
    data.hooks = [hook]
    render(<ExtensionsPage />)
    expect(screen.getByText('Matches shell')).toBeTruthy()
    expect(screen.getByText('No MCP servers yet')).toBeTruthy()
  })
})

describe('McpToolsDialog', () => {
  it('lists tools with the destructive hint and turns one off through mcp:setToolPolicy', async () => {
    const ready: McpServerView = {
      ...server,
      status: {
        id: 'files',
        state: 'ready',
        updatedAt: 2,
        tools: [
          { name: 'read_file', toolName: 'mcp__files__read_file', description: 'Read', risk: 'write', disabled: false },
          {
            name: 'delete_file',
            toolName: 'mcp__files__delete_file',
            description: 'Delete',
            risk: 'destructive',
            declaredDestructive: true,
            disabled: false,
          },
        ],
      },
    }
    invokeMock.mockResolvedValue(ready)
    const onChanged = vi.fn()
    render(<McpToolsDialog server={ready} onClose={() => {}} onChanged={onChanged} />)
    expect(screen.getByText('服务器标注为破坏性，每次都要确认，权限不能调低')).toBeTruthy()
    // a destructive tool has no access choice that could lower it
    expect(screen.getByLabelText('read_file 的权限')).toBeTruthy()
    expect(screen.queryByLabelText('delete_file 的权限')).toBeNull()
    expect(screen.getByRole('switch', { name: '启用 delete_file' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: '启用 read_file' }))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('mcp:setToolPolicy', { id: 'files', tool: 'read_file', disabled: true }),
    )
    expect(onChanged).toHaveBeenCalledWith(ready)
  })
})
