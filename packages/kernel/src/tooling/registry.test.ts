import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, type ToolProfile, type ToolRisk } from '@aiwc/protocol'
import { createToolRegistry } from './registry'

const mk = (name: string, risk: ToolRisk, profiles: ToolProfile[] = ['desktop-chat', 'wechat-bot', 'cron', 'subagent']) =>
  defineTool({
    name,
    description: name,
    inputSchema: z.object({}),
    profiles,
    risk,
    parallelSafe: risk === 'read',
    execute: async () => ({ content: 'ok' }),
  })

describe('createToolRegistry', () => {
  it('register / get / list / unregister; duplicates throw', () => {
    const reg = createToolRegistry()
    reg.register(mk('zeta', 'read'))
    reg.register(mk('alpha', 'read'))
    expect(reg.list().map((t) => t.name)).toEqual(['alpha', 'zeta'])
    expect(reg.get('alpha')?.name).toBe('alpha')
    expect(() => reg.register(mk('alpha', 'read'))).toThrow(/already registered/)
    reg.unregister('alpha')
    expect(reg.get('alpha')).toBeUndefined()
  })

  it('forProfile filters by profile and deny list', () => {
    const reg = createToolRegistry()
    reg.register(mk('search_messages', 'read'))
    reg.register(mk('write_file', 'write', ['desktop-chat']))
    reg.register(mk('secret', 'read'))
    expect(reg.forProfile('cron').map((t) => t.name)).toEqual(['search_messages', 'secret'])
    expect(reg.forProfile('desktop-chat', { deny: ['secret'] }).map((t) => t.name)).toEqual(['search_messages', 'write_file'])
  })

  it('depth > 0 removes delegate_analysis', () => {
    const reg = createToolRegistry()
    reg.register(mk('delegate_analysis', 'read', ['desktop-chat', 'subagent']))
    reg.register(mk('read_thing', 'read'))
    expect(reg.forProfile('subagent', { depth: 0 }).map((t) => t.name)).toContain('delegate_analysis')
    expect(reg.forProfile('subagent', { depth: 1 }).map((t) => t.name)).toEqual(['read_thing'])
  })

  it('wechat-bot keeps only read tools + send_message/send_media even when definitions say otherwise', () => {
    const reg = createToolRegistry()
    reg.register(mk('read_thing', 'read'))
    reg.register(mk('write_file', 'write'))
    reg.register(mk('delete_all', 'destructive'))
    reg.register(mk('push_notify', 'send'))
    reg.register(mk('send_message', 'send'))
    reg.register(mk('send_media', 'send'))
    expect(reg.forProfile('wechat-bot').map((t) => t.name)).toEqual(['read_thing', 'send_media', 'send_message'])
    // other profiles are untouched by the rule
    expect(reg.forProfile('desktop-chat').map((t) => t.name)).toHaveLength(6)
  })
})
