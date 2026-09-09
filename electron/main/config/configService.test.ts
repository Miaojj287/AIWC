import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '@aiwc/protocol'
import { createConfigService, deepMerge } from './configService'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-config-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('deepMerge', () => {
  it('merges nested objects, replaces arrays, skips undefined, deletes on null', () => {
    const base = { a: { b: 1, c: [1, 2], d: 'x' }, e: 2 }
    const out = deepMerge(base, { a: { b: 5, c: [9], d: undefined }, e: null })
    expect(out).toEqual({ a: { b: 5, c: [9], d: 'x' } })
  })
})

describe('configService', () => {
  it('creates config.json with full defaults when missing', () => {
    const file = join(dir, 'config.json')
    const svc = createConfigService({ file })
    expect(existsSync(file)).toBe(true)
    const cfg = svc.get()
    expect(cfg.general.theme).toBe('dark')
    expect(cfg.general.closeBehavior).toBe('ask')
    expect(cfg.agent.maxStepsPerTurn).toBe(40)
    expect(cfg.ui.agentPanelWidth).toBe(360)
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('set() deep-merges, persists atomically and notifies subscribers', () => {
    const file = join(dir, 'config.json')
    const svc = createConfigService({ file })
    const seen: string[] = []
    svc.subscribe((next, prev) => seen.push(`${prev.agent.permissionMode}->${next.agent.permissionMode}`))
    const next = svc.set({ agent: { permissionMode: 'bypass' }, ai: { providers: [{ id: 'p1', kind: 'openai', label: 'OpenAI', models: [] }] } })
    expect(next.agent.permissionMode).toBe('bypass')
    expect(next.agent.maxStepsPerTurn).toBe(40)
    expect(next.ai.providers[0]?.id).toBe('p1')
    expect(seen).toEqual(['ask->bypass'])
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.agent.permissionMode).toBe('bypass')
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('set() throws on invalid patch and keeps the previous config', () => {
    const file = join(dir, 'config.json')
    const svc = createConfigService({ file })
    expect(() => svc.set({ agent: { maxStepsPerTurn: 0 } })).toThrow(/配置无效/)
    expect(svc.get().agent.maxStepsPerTurn).toBe(40)
    expect(JSON.parse(readFileSync(file, 'utf8')).agent.maxStepsPerTurn).toBe(40)
  })

  it('reloads a valid file and falls back to defaults (with backup) on a corrupt one', () => {
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({ version: 1, general: { theme: 'light' } }))
    expect(createConfigService({ file }).get().general.theme).toBe('light')

    writeFileSync(file, '{ not json')
    const svc = createConfigService({ file })
    expect(svc.get().general.theme).toBe('dark')
    expect(readdirSync(dir).some((f) => f.startsWith('config.json.bak-'))).toBe(true)
  })

  it('keeps transformed fields in memory but excludes them from persistence', () => {
    const file = join(dir, 'config.json')
    const resetSession = (cfg: AppConfig): AppConfig => ({
      ...cfg,
      account: {},
      onboarding: { completed: false },
    })
    const svc = createConfigService({ file, transformLoaded: resetSession, transformPersisted: resetSession })
    svc.set({ account: { wxid: 'wxid_dev', dbRoot: '/wechat' }, onboarding: { completed: true }, general: { theme: 'light' } })

    expect(svc.get().account.wxid).toBe('wxid_dev')
    expect(svc.get().onboarding.completed).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ account: {}, onboarding: { completed: false }, general: { theme: 'light' } })

    const again = createConfigService({ file, transformLoaded: resetSession, transformPersisted: resetSession })
    expect(again.get().account).toEqual({})
    expect(again.get().onboarding.completed).toBe(false)
    expect(again.get().general.theme).toBe('light')
  })
})
