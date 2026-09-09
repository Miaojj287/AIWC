import { describe, expect, it, vi } from 'vitest'
import { createBackgroundAxInjector, type AxProfile } from './backgroundAx'

const inspect = async () => ({ ok: true, hasWritableWindowInput: true })
const selector = (id: string) => ({ role: 'AXGroup', identifier: id })
const profile: AxProfile = {
  wechatVersion: 'test', conversationList: selector('list'), conversationRow: selector('row'),
  header: selector('header'), composer: selector('composer'), sendButton: selector('send'),
}

describe('background AX injector', () => {
  it('requires a successful selection and fill before committing', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const injector = createBackgroundAxInjector({ profile, run, inspect })
    await expect(injector.commit()).rejects.toThrow('未确认')
    await expect(injector.fill('hello')).rejects.toThrow('未确认')
    expect(run).not.toHaveBeenCalled()
    await injector.focusSession('Alice')
    await injector.fill('你好\n世界')
    await injector.commit()
    expect(run.mock.calls).toEqual([
      [{ action: 'select', name: 'Alice', text: undefined, profile }],
      [{ action: 'fill', name: 'Alice', text: '你好\n世界', profile }],
      [{ action: 'commit', name: 'Alice', text: '你好\n世界', profile }],
    ])
    expect(injector.retryCommit).toBe(false)
  })

  it('fails closed without a verified profile', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ run, inspect })
    await expect(injector.focusSession('Alice')).rejects.toThrow('尚未配置')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects missing identifiers and missing version', async () => {
    for (const bad of [{ ...profile, wechatVersion: '' }, { ...profile, composer: selector('') }]) {
      const run = vi.fn()
      await expect(createBackgroundAxInjector({ profile: bad, run, inspect }).focusSession('Alice')).rejects.toThrow('配置')
      expect(run).not.toHaveBeenCalled()
    }
  })

  it('only permits a busy retry before a write has started', async () => {
    const run = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'busy' })
      .mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'busy', detail: 'foreground changed' })
    const injector = createBackgroundAxInjector({ profile, run, inspect })
    await expect(injector.focusSession('Alice')).rejects.toMatchObject({ reason: 'busy' })
    await injector.focusSession('Alice')
    await expect(injector.fill('draft')).rejects.toMatchObject({ reason: 'unsupported' })
    await expect(injector.commit()).rejects.toThrow('未确认')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('invalidates old target after failed selection and old text after failed fill', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    const injector = createBackgroundAxInjector({ profile, run, inspect })
    await injector.focusSession('Alice')
    await injector.fill('old')
    run.mockResolvedValueOnce({ ok: false, reason: 'unsupported' })
    await expect(injector.focusSession('Bob')).rejects.toThrow()
    await expect(injector.commit()).rejects.toThrow('未确认')
    await expect(injector.fill('new')).rejects.toThrow('未确认')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('reports a missing helper without invoking the foreground injector', async () => {
    const injector = createBackgroundAxInjector({ profile })
    await expect(injector.focusSession('Alice')).rejects.toThrow('未配置后台回复辅助程序')
  })
})


describe('read-only capability gate', () => {
  it('refuses a Qt window shell before selecting a chat, even with a supplied profile', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ profile, run, inspect: async () => ({ok: true, hasWritableWindowInput: false, version: '4.1.13'}) })
    await expect(injector.focusSession('Alice')).rejects.toThrow('静默发送不可用')
    expect(run).not.toHaveBeenCalled()
  })
  it('reports denied permission before any write', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ profile, run, inspect: async () => ({ok: false, reason: 'no-permission', detail: '未授予辅助功能权限'}) })
    await expect(injector.focusSession('Alice')).rejects.toMatchObject({reason: 'no-permission'})
    expect(run).not.toHaveBeenCalled()
  })
})


describe('window capture diagnostics', () => {
  it('identifies capture exclusion separately and never attempts blind input', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ profile, run, inspect: async () => ({ ok: true, hasWritableWindowInput: false, windowSharing: 'excluded', screenCapturePermission: true }) })
    await expect(injector.focusSession('Alice')).rejects.toThrow('系统报告微信主窗口不可捕获')
    expect(run).not.toHaveBeenCalled()
  })
  it('does not claim screenshot exclusion from an unknown sharing state', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ profile, run, inspect: async () => ({ ok: true, hasWritableWindowInput: false, windowSharing: 'unknown' }) })
    await expect(injector.focusSession('Alice')).rejects.toThrow('未暴露可后台写入')
    expect(run).not.toHaveBeenCalled()
  })
})
