import { describe, expect, it } from 'vitest'
import { AppConfigSchema, defaultConfig } from './config'

describe('AppConfig', () => {
  it('produces full defaults from an empty object', () => {
    const cfg = defaultConfig()
    expect(cfg.general.theme).toBe('dark')
    expect(cfg.agent.permissionMode).toBe('ask')
    expect(cfg.agent.maxStepsPerTurn).toBe(40)
    expect(cfg.ui.agentPanelWidth).toBe(360)
    // 每日待办 is opt-in: nothing is scanned or sent until the user turns it on and picks chats.
    expect(cfg.todo).toEqual({
      enabled: false,
      sources: [],
      schedule: { kind: 'daily', time: '09:00' },
      maxMessagesPerSource: 200,
    })
  })
  it('drops the retired diary section and repairs a bad todo schedule without dropping the rest', () => {
    const cfg = AppConfigSchema.parse({
      diary: { enabled: true, hour: 2 },
      todo: { enabled: true, schedule: { kind: 'hourly', everyHours: 5 }, sources: [{ id: 'g@chatroom', title: 'G' }] },
      agent: { maxStepsPerTurn: 7 },
    })
    expect('diary' in cfg).toBe(false)
    expect(cfg.todo.enabled).toBe(true)
    expect(cfg.todo.schedule).toEqual({ kind: 'daily', time: '09:00' })
    expect(cfg.todo.sources).toEqual([{ id: 'g@chatroom', title: 'G' }])
    expect(cfg.agent.maxStepsPerTurn).toBe(7)
    expect(AppConfigSchema.parse({ todo: { schedule: { kind: 'hourly', everyHours: 6 } } }).todo.schedule).toEqual({
      kind: 'hourly',
      everyHours: 6,
    })
  })
  it('accepts partial nested input', () => {
    const cfg = AppConfigSchema.parse({ agent: { permissionMode: 'bypass' } })
    expect(cfg.agent.permissionMode).toBe('bypass')
    expect(cfg.agent.maxStepsPerTurn).toBe(40)
  })
  it("falls back to Ask for a mode written by an older build ('plan') instead of failing the config", () => {
    const cfg = AppConfigSchema.parse({
      agent: { permissionMode: 'plan', maxStepsPerTurn: 12 },
      ai: { defaultModel: { providerId: 'p', modelId: 'm' } },
    })
    expect(cfg.agent.permissionMode).toBe('ask')
    // the rest of the config survives — losing it would take the user's providers and keys with it
    expect(cfg.agent.maxStepsPerTurn).toBe(12)
    expect(cfg.ai.defaultModel).toEqual({ providerId: 'p', modelId: 'm' })
  })
  it('defaults the pet on and repairs a bad pet selection without dropping the rest', () => {
    expect(defaultConfig().pet).toEqual({
      enabled: true,
      bubbles: true,
      motion: true,
      idleFlair: true,
      size: 'md',
      showRunning: true,
      showDone: true,
      showUnread: true,
    })
    const cfg = AppConfigSchema.parse({
      pet: { current: '../../etc', size: 'huge', bubbles: false },
      agent: { maxStepsPerTurn: 9 },
    })
    expect(cfg.pet).toMatchObject({ enabled: true, bubbles: false, motion: true, idleFlair: true, size: 'md' })
    expect(cfg.agent.maxStepsPerTurn).toBe(9)
    expect(AppConfigSchema.parse({ pet: { current: 'apex-nessie' } }).pet.current).toBe('apex-nessie')
  })
  it('remembers the window layout (Agent window) and repairs an unknown one without dropping the rest', () => {
    const cfg = defaultConfig()
    expect(cfg.ui.shellMode).toBe('workbench')
    expect(cfg.ui.agentWindowSidebarCollapsed).toBe(false)
    expect(cfg.ui.agentWindowSidebarWidth).toBe(260)
    expect(cfg.ui.agentWindowWorkspaceWidth).toBe(560)
    expect(AppConfigSchema.parse({ ui: { shellMode: 'agent' } }).ui.shellMode).toBe('agent')
    expect(AppConfigSchema.parse({ ui: { shellMode: 'split', agentPanelWidth: 400 } }).ui).toMatchObject({
      shellMode: 'workbench',
      agentPanelWidth: 400,
    })
  })
  it('rejects invalid values', () => {
    expect(() => AppConfigSchema.parse({ agent: { maxStepsPerTurn: 0 } })).toThrow()
  })
})
