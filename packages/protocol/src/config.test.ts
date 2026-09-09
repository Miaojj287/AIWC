import { describe, expect, it } from 'vitest'
import { AppConfigSchema, defaultConfig } from './config'

describe('AppConfig', () => {
  it('produces full defaults from an empty object', () => {
    const cfg = defaultConfig()
    expect(cfg.general.theme).toBe('dark')
    expect(cfg.agent.permissionMode).toBe('ask')
    expect(cfg.agent.maxStepsPerTurn).toBe(40)
    expect(cfg.ui.agentPanelWidth).toBe(360)
    expect(cfg.diary.hour).toBe(2)
  })
  it('accepts partial nested input', () => {
    const cfg = AppConfigSchema.parse({ agent: { permissionMode: 'bypass' } })
    expect(cfg.agent.permissionMode).toBe('bypass')
    expect(cfg.agent.maxStepsPerTurn).toBe(40)
  })
  it("falls back to Ask for a mode written by an older build ('plan') instead of failing the config", () => {
    const cfg = AppConfigSchema.parse({ agent: { permissionMode: 'plan', maxStepsPerTurn: 12 }, ai: { defaultModel: { providerId: 'p', modelId: 'm' } } })
    expect(cfg.agent.permissionMode).toBe('ask')
    // the rest of the config survives — losing it would take the user's providers and keys with it
    expect(cfg.agent.maxStepsPerTurn).toBe(12)
    expect(cfg.ai.defaultModel).toEqual({ providerId: 'p', modelId: 'm' })
  })
  it('rejects invalid values', () => {
    expect(() => AppConfigSchema.parse({ agent: { maxStepsPerTurn: 0 } })).toThrow()
  })
})
