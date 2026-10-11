import { describe, expect, it } from 'vitest'
import { McpServerConfigSchema } from '@aiwc/protocol'
import { createMcpToolDefinition, effectiveRisk } from './tools'

const server = (toolRisk: Record<string, 'read' | 'write' | 'send'> = {}) =>
  McpServerConfigSchema.parse({
    id: 'files',
    label: 'Files',
    transport: 'stdio',
    command: '/usr/bin/true',
    defaultRisk: 'write',
    toolRisk,
  })

describe('MCP tool risk', () => {
  it('keeps a server-declared destructive tool destructive whatever the user override says', () => {
    const rm = { name: 'rm', annotations: { destructiveHint: true } }
    expect(effectiveRisk(server({ rm: 'read' }), rm)).toBe('destructive')
    const def = createMcpToolDefinition({
      server: server({ rm: 'read' }),
      tool: rm,
      toolName: 'mcp__files__rm',
      call: async () => ({ text: '', isError: false }),
    })
    expect(def.risk).toBe('destructive')
  })

  it('applies the override otherwise, and a read-only hint never lowers the default', () => {
    expect(effectiveRisk(server({ ls: 'read' }), { name: 'ls' })).toBe('read')
    expect(effectiveRisk(server(), { name: 'ls', annotations: { readOnlyHint: true } })).toBe('write')
    // contradictory hints: not treated as destructive, the user's choice stands
    const both = { name: 'odd', annotations: { destructiveHint: true, readOnlyHint: true } }
    expect(effectiveRisk(server({ odd: 'send' }), both)).toBe('send')
  })
})
