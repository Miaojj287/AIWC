import { describe, expect, it } from 'vitest'
import type { McpServerView } from '@aiwc/protocol'
import {
  blankHookForm,
  blankMcpForm,
  hookDraftFromForm,
  mcpDraftFromForm,
  mcpFormFromView,
  statusBadge,
  suggestServerId,
  validateHookForm,
  validateMcpForm,
} from './extensionsModel'

const view: McpServerView = {
  id: 'files',
  label: 'Files',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'server'],
  url: '',
  defaultRisk: 'write',
  toolRisk: { read_file: 'read' },
  disabledTools: [],
  timeoutMs: 120_000,
  secrets: [{ name: 'TOKEN', hasValue: true }],
  status: {
    id: 'files',
    state: 'ready',
    tools: [
      { name: 'a', toolName: 'mcp__files__a', description: '', risk: 'write', disabled: false },
      { name: 'b', toolName: 'mcp__files__b', description: '', risk: 'write', disabled: true },
    ],
    updatedAt: 0,
  },
}

describe('MCP form', () => {
  it('round-trips a view into a draft, keeping stored secrets by leaving their value out', () => {
    const draft = mcpDraftFromForm(mcpFormFromView(view))
    expect(draft).toMatchObject({ originalId: 'files', id: 'files', args: ['-y', 'server'], timeoutMs: 120_000 })
    expect(draft.secrets).toEqual([{ name: 'TOKEN' }])
  })

  it('validates inline: id shape and uniqueness, command, url scheme, secret names, timeout', () => {
    const form = { ...blankMcpForm(), label: 'X', id: 'Bad', command: '' }
    expect(validateMcpForm(form, [])).toMatchObject({
      id: 'settings.extensions.mcp.form.errors.id',
      command: 'settings.extensions.mcp.form.errors.command',
    })
    expect(validateMcpForm({ ...form, id: 'taken', command: 'x' }, ['taken']).id).toBe(
      'settings.extensions.mcp.form.errors.idTaken',
    )
    const http = { ...blankMcpForm(), label: 'W', id: 'web', transport: 'http' as const, url: 'http://example.com' }
    expect(validateMcpForm(http, []).url).toBeDefined()
    expect(validateMcpForm({ ...http, url: 'http://localhost:3000/mcp' }, []).url).toBeUndefined()
    expect(
      validateMcpForm({ ...http, url: 'https://x.dev', secrets: [{ name: 'a b', value: '', stored: false }] }, [])
        .secrets,
    ).toBeDefined()
    expect(validateMcpForm({ ...http, url: 'https://x.dev', timeoutSec: '2' }, []).timeout).toBeDefined()
  })

  it('refuses env variables that change what a local command runs, but not the same names as HTTP headers', () => {
    const stdio = { ...blankMcpForm(), label: 'X', id: 'local', command: 'npx' }
    const reserved = [{ name: 'NODE_OPTIONS', value: '--require x', stored: false }]
    expect(validateMcpForm({ ...stdio, secrets: reserved }, []).secrets).toBe(
      'settings.extensions.mcp.form.errors.secretsReserved',
    )
    const http = { ...stdio, transport: 'http' as const, url: 'https://x.dev', secrets: reserved }
    expect(validateMcpForm(http, []).secrets).toBeUndefined()
  })

  it('suggests a tool-name-safe id and counts only enabled tools in the badge', () => {
    expect(suggestServerId('GitHub Issues!')).toBe('github_issues')
    expect(suggestServerId('123 go')).toBe('s_123_go')
    expect(statusBadge(view.status)).toEqual({ tone: 'ok', key: 'settings.extensions.mcp.status.ready', n: 1 })
  })
})

describe('hook form', () => {
  it('drops the matcher for non-tool events and rejects bad regexes', () => {
    expect(validateHookForm({ ...blankHookForm(), command: 'x', matcher: '(' }).matcher).toBeDefined()
    expect(hookDraftFromForm({ ...blankHookForm(), event: 'Stop', matcher: 'shell', command: ' ./a ' })).toMatchObject({
      matcher: '',
      command: './a',
      timeoutMs: 60_000,
    })
  })
})
